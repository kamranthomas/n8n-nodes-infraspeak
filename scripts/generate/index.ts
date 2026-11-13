/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals, no-console --
 * Dev-only build script: reads the spec and writes files. Never shipped (package.json
 * `files` is only `dist`), so the Cloud rules for node runtime code don't apply. */
/**
 * Generates the Infraspeak node's resource descriptions from the OpenAPI spec.
 *
 *   npm run generate
 *
 * Inputs:  docs/api/openapi-full.yaml + scripts/generate/overrides.ts
 * Outputs: nodes/Infraspeak/resources/*.ts (committed, shipped)
 *          test/generated/manifest.json (drives the spec-conformance tests)
 *
 * Fails loudly on anything it can't map instead of guessing: add an override.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
	apiRules,
	globalFields,
	locators,
	propertyLocators,
	resources,
	type FieldOverride,
	type LocatorKey,
	type OperationOverride,
	type ResourceConfig,
} from './overrides';
import { loadSpec, primaryType, type Param, type Schema, type SpecOperation } from './spec';

const RESOURCES_DIR = 'nodes/Infraspeak/resources';
const MANIFEST_PATH = 'test/generated/manifest.json';

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Raw TypeScript code embedded in a generated object literal. */
class Raw {
	constructor(readonly code: string) {}
}
const raw = (code: string) => new Raw(code);

const ACRONYMS: Record<string, string> = {
	id: 'ID',
	ids: 'IDs',
	nfc: 'NFC',
	uuid: 'UUID',
	nif: 'NIF',
	url: 'URL',
	sla: 'SLA',
	iban: 'IBAN',
	vat: 'VAT',
};

function words(name: string): string[] {
	return name
		.replace(/\[|\]/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s_\-.]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

function titleCase(name: string): string {
	return words(name)
		.map((w) => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

/**
 * Label for a query param written in Infraspeak's filter syntax (developer docs,
 * "Parameters"): s_<field> equals, s_<field>_like contains, s_<field>_in / _notin
 * any / none of, sc_<scope> a named scope. Plain names fall back to title case.
 */
function filterLabel(name: string): string {
	const bound = /^date_(min|max)_(.+)$/.exec(name);
	if (bound) return `${titleCase(bound[2].replace(/_date$/, ''))} ${bound[1] === 'min' ? 'After' : 'Before'}`;
	const match = /^(s|sc)_(.+?)(_like|_in|_notin)?$/.exec(name);
	if (!match) return titleCase(name);
	const [, , field, op] = match;
	const suffix = { _like: ' Contains', _in: ' (Any Of)', _notin: ' (None Of)' }[op ?? ''] ?? '';
	return `${titleCase(field)}${suffix}`;
}

/** n8n parameter name for a query param: the label's words, so it reads like the UI. */
function filterName(name: string): string {
	return camelCase(filterLabel(name).replace(/[()]/g, ''));
}

function camelCase(name: string): string {
	return words(name)
		.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
		.join('');
}

/** First sentence of a spec description, as plain text without a trailing period. */
function cleanDescription(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const firstParagraph = text.trim().split(/\n\s*\n/)[0];
	const plain = firstParagraph
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/[`*]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const sentence = plain.match(/^.*?[.!?](\s|$)/)?.[0] ?? plain;
	// n8n lint wants "ID", never "id", in descriptions.
	return sentence.trim().replace(/\.$/, '').replace(/\bid(s?)\b/g, 'ID$1') || undefined;
}

const normalize = (text: string) =>
	text
		.toLowerCase()
		.replace(/^(the|a|an)\s+/, '')
		.replace(/[^a-z0-9]/g, '');

/**
 * n8n lint rejects descriptions that only repeat the display name (ignoring a
 * leading article), so drop them everywhere in the generated tree.
 */
function dropRedundantDescriptions(value: unknown): unknown {
	if (value instanceof Raw || value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(dropRedundantDescriptions);
	const entries = Object.entries(value).map(([k, v]) => [k, dropRedundantDescriptions(v)] as const);
	const obj = Object.fromEntries(entries) as Record<string, unknown>;
	if (
		typeof obj.displayName === 'string' &&
		typeof obj.description === 'string' &&
		normalize(obj.description) === normalize(obj.displayName)
	) {
		delete obj.description;
	}
	return obj;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

class GeneratorError extends Error {}
/** Unrecoverable: stop immediately. */
const fail = (message: string): never => {
	throw new GeneratorError(message);
};
/**
 * Recoverable: record it and keep going, so one run reports every override that's
 * missing. Nothing is written if any were recorded.
 */
const problems: string[] = [];
const problem = (message: string) => {
	problems.push(message);
};

// ─── Manifest (what the conformance tests check) ─────────────────────────────

/** How a field's value is turned into the request. Mirrors the runtime expressions. */
type ValueKind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'options'
	| 'date'
	| 'intArray'
	| 'stringArray'
	| 'json'
	| 'locator';

interface ManifestField {
	/** Container: top level, or the collection's parameter name. */
	container: string;
	name: string;
	kind: ValueKind;
	/** Where the value is sent. */
	target: 'body' | 'query' | 'path' | 'none';
	/** Body/query property, or path param name. */
	property?: string;
	required: boolean;
	options?: Array<string | number>;
	/** JSON-schema string format (e.g. uuid), so tests can send a valid sample. */
	format?: string;
	/** Shown only for these selector values (merged list variants). */
	showFor?: string[];
	/** JSON fields: the property's schema, so tests can build a valid sample. */
	schema?: Schema;
	/** Query arrays sent as typed text: the item type, so tests can send a valid sample. */
	arrayItems?: string;
	/** Body variant (oneOf) this field belongs to; absent for fields common to all. */
	variant?: string;
	/** Dates whose spec pattern demands ISO 8601 instead of YYYY-MM-DD HH:MM:SS. */
	dateFormat?: 'iso';
}

interface ManifestOperation {
	resource: string;
	operation: string;
	operationId: string;
	method: string;
	/** Spec path template, e.g. /failures/{failure}. */
	path: string;
	output: 'records' | 'deleted' | 'success';
	list: boolean;
	selector?: { name: string; value: string };
	/** oneOf body variant this entry exercises. */
	variant?: string;
	fields: ManifestField[];
	allowedQuery: string[];
	bodySchema?: Schema;
}

// ─── Field building ──────────────────────────────────────────────────────────

interface FieldContext {
	resource: ResourceConfig;
	operation: string;
	show: Record<string, unknown>;
}

function fieldOverride(
	resource: ResourceConfig,
	op: OperationOverride | undefined,
	prop: string,
): FieldOverride {
	return { ...globalFields[prop], ...resource.fields?.[prop], ...op?.fields?.[prop] };
}

function locatorProperty(
	key: LocatorKey,
	description: string | undefined,
	routing: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const locator = locators[key];
	return {
		displayName: locator.displayName,
		name: locator.fieldName,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		description: description ?? locator.description,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: locator.listSearch, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 123',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[0-9]+$', errorMessage: 'Not a valid ID: must be a number' },
					},
				],
			},
		],
		...(routing ? { routing } : {}),
	};
}

/**
 * Nested objects and arrays of objects (recurrence rules, SLA rules, ...) have no
 * sensible flat form, so they're a JSON field the user fills with the spec's structure.
 */
function jsonField(
	base: Record<string, unknown>,
	schema: Schema,
	defaultValue: string,
	routing: Record<string, unknown>,
	manifest: (kind: ValueKind, extra?: Partial<ManifestField>) => ManifestField,
): { property: Record<string, unknown>; manifest: ManifestField } {
	// n8n lint: one sentence takes no final period, several sentences take one.
	const hint = 'JSON in the structure the Infraspeak API documents for this field';
	const description = base.description ? `${String(base.description)}. ${hint}.` : hint;
	return {
		property: {
			...base,
			type: 'json',
			default: defaultValue,
			description,
			routing,
		},
		manifest: manifest('json', { schema }),
	};
}

/**
 * Builds the n8n properties (one, or two for date ranges / dependent locators) for
 * a body property or query param, plus their manifest entries.
 */
function buildValueFields(
	prop: string,
	schema: Schema,
	target: 'body' | 'query',
	container: string,
	required: boolean,
	override: FieldOverride,
	ctx: FieldContext,
): Array<{ property: Record<string, unknown>; manifest: ManifestField }> {
	const type = primaryType(schema);
	const description = override.description ?? cleanDescription(schema.description);
	const send = (property: string, value?: string) => ({
		send: { type: target, property, ...(value ? { value } : {}) },
	});
	const where = `${ctx.resource.value}.${ctx.operation}.${prop}`;

	// Resource locator
	// Name-based locators only fit single IDs: `local_id` is an array on some bodies.
	const locatorKey =
		override.locator === null
			? undefined
			: (override.locator ?? (type === 'array' ? undefined : propertyLocators[prop]));
	if (locatorKey) {
		const locator = locators[locatorKey];
		const fields: Array<{ property: Record<string, unknown>; manifest: ManifestField }> = [];
		if (locator.dependsOn) {
			// UI-only helper that narrows this locator's list; never sent to the API.
			const parent = locators[locator.dependsOn];
			fields.push({
				property: locatorProperty(
					locator.dependsOn,
					`Narrows the ${locator.displayName} list. Not sent to Infraspeak.`,
					undefined,
				),
				manifest: {
					container,
					name: parent.fieldName,
					kind: 'locator',
					target: 'none',
					required: false,
				},
			});
		}
		fields.push({
			property: {
				...locatorProperty(
					locatorKey,
					override.description,
					send(prop, '={{ RESOURCE_LOCATOR_ID }}'),
				),
				...(override.displayName ? { displayName: override.displayName } : {}),
			},
			manifest: {
				container,
				name: locator.fieldName,
				kind: 'locator',
				target,
				property: prop,
				required,
			},
		});
		return fields;
	}

	// `_type` and `type` can coexist in one body, so a leading underscore must survive in the name.
	// `_type` and `type` can coexist in one body, so a leading underscore must survive in the name.
	const plainName =
		target === 'query'
			? filterName(prop)
			: prop.startsWith('_')
				? camelCase(`object${prop}`)
				: camelCase(prop);
	// n8n treats these names specially (operation/resource selectors), so never reuse them.
	const RESERVED = ['resource', 'operation', 'action'];
	const name =
		override.name ??
		(RESERVED.includes(plainName) ? camelCase(`${ctx.resource.singular} ${plainName}`) : plainName);
	const displayName =
		override.displayName ??
		(target === 'query'
			? filterLabel(prop)
			: prop.startsWith('_')
				? titleCase(`object${prop}`)
				: titleCase(prop));
	const base = { displayName, name, ...(description ? { description } : {}) };
	const manifest = (kind: ValueKind, extra: Partial<ManifestField> = {}): ManifestField => ({
		container,
		name,
		kind,
		target,
		property: prop,
		required,
		...extra,
	});

	// Date-time query param that is already one bound of a range (date_min_x / date_max_x)
	const bound = /^date_(min|max)_(.+)$/.exec(prop);
	// The spec doesn't always type these as date-time, but the prefix says what they are.
	if (type === 'string' && target === 'query' && bound) {
		const edge = bound[1] === 'min' ? 'After' : 'Before';
		const stem = override.dateLabel ?? titleCase(bound[2].replace(/_date$/, ''));
		const fieldName = override.name ?? camelCase(`${stem} ${edge}`);
		return [
			{
				property: {
					displayName: override.displayName ?? `${stem} ${edge}`,
					name: fieldName,
					type: 'dateTime',
					default: '',
					description: `Only ${ctx.resource.plural} with ${stem.toLowerCase()} ${edge === 'After' ? 'on or after' : 'on or before'} this date`,
					routing: send(prop, '={{ INFRASPEAK_DATE }}'),
				},
				manifest: { container, name: fieldName, kind: 'date', target, property: prop, required: false },
			},
		];
	}

	// Date-time query param → After/Before range pair
	if (type === 'string' && schema.format === 'date-time' && target === 'query') {
		const stem = override.dateLabel ?? titleCase(prop.replace(/_date$/, ''));
		const nameStem = camelCase(stem);
		return (['After', 'Before'] as const).map((edge) => {
			const property = `${edge === 'After' ? apiRules.dateRange.min : apiRules.dateRange.max}${prop}`;
			const fieldName = `${nameStem}${edge}`;
			return {
				property: {
					displayName: `${stem} ${edge}`,
					name: fieldName,
					type: 'dateTime',
					default: '',
					description: `Only ${ctx.resource.plural} with ${titleCase(prop).toLowerCase()} ${edge === 'After' ? 'on or after' : 'on or before'} this date`,
					routing: send(property, '={{ INFRASPEAK_DATE }}'),
				},
				manifest: { container, name: fieldName, kind: 'date', target, property, required: false },
			};
		});
	}

	// A body property that allows exactly one value is a constant: send it, don't ask for it.
	if (target === 'body' && schema.enum?.length === 1 && !override.options) {
		const value = schema.enum[0];
		return [
			{
				property: { ...base, type: 'hidden', default: value, routing: send(prop) },
				manifest: manifest('options', { options: [value] }),
			},
		];
	}

	// sort with a pattern listing its fields, e.g. ^(name|code)(-)?$ → ascending/descending options
	const sortFields = /^\^\(([\w|]+)\)\(-\)\?\$$/.exec(String(schema.pattern ?? ''));
	if (target === 'query' && sortFields && !override.options) {
		const options = sortFields[1]
			.split('|')
			.flatMap((field) => [
				{ name: `${titleCase(field)} (Ascending)`, value: field },
				{ name: `${titleCase(field)} (Descending)`, value: `${field}-` },
			])
			.sort((a, b) => a.name.localeCompare(b.name));
		return [
			{
				property: { ...base, type: 'options', options, default: options[0].value, routing: send(prop) },
				manifest: manifest('options', { options: options.map((o) => o.value) }),
			},
		];
	}

	if (schema.enum || override.options) {
		// A nullable enum lists null as a value: not something a dropdown can offer.
		const options =
			override.options ??
			(schema.enum ?? [])
				.filter((v) => v !== null)
				.map((v) => ({ name: titleCase(String(v)), value: v }));
		const sorted = [...options].sort((a, b) => a.name.localeCompare(b.name));
		return [
			{
				property: {
					...base,
					type: 'options',
					options: sorted,
					default: sorted[0].value,
					routing: send(prop),
				},
				manifest: manifest('options', { options: sorted.map((o) => o.value) }),
			},
		];
	}

	switch (type) {
		case 'string': {
			// A date: typed date-time, or a plain string whose pattern describes a date-time.
			const pattern = String(schema.pattern ?? '');
			const datePattern = /^\^\\d\{4\}-.*:/.test(pattern);
			if (schema.format === 'date-time' || datePattern) {
				// The spec mixes formats: a field whose pattern demands ISO 8601 (a literal T)
				// gets ISO; everything else gets the README's YYYY-MM-DD HH:MM:SS.
				const iso = /\)T\(/.test(pattern);
				return [
					{
						property: {
							...base,
							type: 'dateTime',
							default: '',
							routing: send(prop, iso ? '={{ ISO_DATE }}' : '={{ INFRASPEAK_DATE }}'),
						},
						manifest: manifest('date', iso ? { dateFormat: 'iso' } : {}),
					},
				];
			}
			const multiline = override.multiline ?? false;
			// n8n lint: email fields carry an example address, password fields are masked.
			const isEmail = /(^|_)email$/.test(prop);
			const isPassword = /(^|_)password$/.test(prop);
			return [
				{
					property: {
						...base,
						type: 'string',
						default: '',
						...(isEmail ? { placeholder: 'name@email.com' } : {}),
						...(isPassword ? { typeOptions: { password: true } } : {}),
						...(multiline ? { typeOptions: { rows: 4 } } : {}),
						routing: send(prop),
					},
					manifest: manifest('string', schema.format ? { format: schema.format } : {}),
				},
			];
		}
		case 'integer':
		case 'number':
			return [
				{
					property: { ...base, type: 'number', default: 0, routing: send(prop) },
					manifest: manifest('number'),
				},
			];
		case 'boolean': {
			if (!description?.startsWith('Whether')) {
				problem(
					`${where}: boolean needs a description starting with "Whether" (add a field override)`,
				);
			}
			return [
				{
					property: { ...base, type: 'boolean', default: false, routing: send(prop) },
					manifest: manifest('boolean'),
				},
			];
		}
		case 'array': {
			const itemType = schema.items ? primaryType(schema.items) : undefined;
			// Query arrays: the encoding the API expects is undocumented, so send the text as typed.
			if (target === 'query') {
				return [
					{
						property: {
							...base,
							type: 'string',
							default: '',
							placeholder: 'e.g. A1,B2',
							routing: send(prop),
						},
						manifest: manifest('string', { arrayItems: itemType }),
					},
				];
			}
			if (itemType === 'integer' || itemType === 'string') {
				const isInt = itemType === 'integer';
				return [
					{
						property: {
							...base,
							type: 'string',
							default: '',
							placeholder: isInt ? 'e.g. 1, 2, 3' : 'e.g. first, second',
							routing: send(prop, isInt ? '={{ INT_ARRAY }}' : '={{ STRING_ARRAY }}'),
						},
						manifest: manifest(isInt ? 'intArray' : 'stringArray'),
					},
				];
			}
			return [jsonField(base, schema, '[]', send(prop, '={{ JSON_VALUE }}'), manifest)];
		}
		case 'object':
			return [jsonField(base, schema, '{}', send(prop, '={{ JSON_VALUE }}'), manifest)];
		default:
			problem(`${where}: unsupported schema type ${JSON.stringify(schema.type)}`);
			return [];
	}
}

function sortByDisplayName<T extends { displayName?: unknown }>(items: T[]): T[] {
	return [...items].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
}

// ─── Operation building ──────────────────────────────────────────────────────

interface BuiltOperation {
	value: string;
	option: Record<string, unknown>;
	properties: Array<Record<string, unknown> | Raw>;
	manifests: ManifestOperation[];
}

function classify(
	op: SpecOperation,
	resource: ResourceConfig,
	override: OperationOverride | undefined,
): { value: string; name: string; action: string; description: string } {
	const s = resource.singular;
	const crud = (() => {
		const hasTrailingParam = /\}$/.test(op.path);
		if (
			override?.list ||
			(override?.list !== false &&
				op.method === 'get' &&
				op.returns === 'records' &&
				!hasTrailingParam)
		)
			return { value: 'getAll', name: 'Get Many', action: `Get many ${resource.plural}` };
		if (op.method === 'get' && hasTrailingParam)
			return { value: 'get', name: 'Get', action: `Get ${article(s)} ${s}` };
		if (op.method === 'post' && op.pathParams.length === 0)
			return { value: 'create', name: 'Create', action: `Create ${article(s)} ${s}` };
		if (op.method === 'patch' && hasTrailingParam && op.pathParams.length === 1)
			return { value: 'update', name: 'Update', action: `Update ${article(s)} ${s}` };
		if (op.method === 'delete' && hasTrailingParam && op.pathParams.length === 1)
			return { value: 'delete', name: 'Delete', action: `Delete ${article(s)} ${s}` };
		return undefined;
	})();

	const value = override?.value ?? crud?.value;
	const name = override?.name ?? crud?.name;
	const action = override?.action ?? crud?.action;
	if (!value || !name || !action) {
		problem(
			`${resource.tag} ${op.operationId} (${op.method.toUpperCase()} ${op.path}) isn't plain CRUD: add value/name/action overrides`,
		);
		return { value: op.operationId, name: op.operationId, action: op.operationId, description: '' };
	}
	return { value, name, action, description: override?.description ?? action };
}

function urlExpression(
	path: string,
	pathParamNames: Record<string, { field: string; locator: boolean }>,
): string {
	const url = path.replace(/\{([^}]+)\}/g, (_, param: string) => {
		const { field, locator } = pathParamNames[param];
		const read = locator
			? `(typeof $parameter.${field} === "object" ? $parameter.${field}.value : $parameter.${field})`
			: `$parameter.${field}`;
		return `{{ encodeURIComponent(String(${read})) }}`;
	});
	return url.includes('{{') ? `=${url}` : url;
}

function buildOperation(
	resource: ResourceConfig,
	ops: SpecOperation[],
	selector?: { name: string; byOperationId: Record<string, string> },
): BuiltOperation {
	const primary = ops[0];
	const override = resource.operations?.[primary.operationId];
	const meta = classify(primary, resource, override);
	const show = { resource: [resource.value], operation: [meta.value] };
	const ctx: FieldContext = { resource, operation: meta.value, show };

	const topLevel: Array<Record<string, unknown> | Raw> = [];
	// Keyed by container plus body variant: a oneOf body gets one collection per variant.
	const collections: Record<
		string,
		{
			name: string;
			displayName: string;
			placeholder: string;
			show: Record<string, unknown>;
			items: Array<Record<string, unknown>>;
		}
	> = {};
	const manifestFields: ManifestField[] = [];
	const addToCollection = (
		container: string,
		displayName: string,
		placeholder: string,
		property: Record<string, unknown>,
		variant?: { key: string; show: Record<string, unknown> },
	) => {
		const key = `${container}|${variant?.key ?? ''}`;
		collections[key] ??= {
			name: container,
			displayName,
			placeholder,
			show: variant?.show ?? show,
			items: [],
		};
		collections[key].items.push(property);
	};

	// Selector for merged list variants (e.g. Failure Status Group)
	if (selector && resource.listVariants) {
		const variants = Object.values(resource.listVariants.variants);
		topLevel.push({
			displayName: resource.listVariants.selector.displayName,
			name: selector.name,
			type: 'options',
			noDataExpression: true,
			options: [...variants].sort((a, b) => a.name.localeCompare(b.name)),
			default: variants[0].value,
			description: resource.listVariants.selector.description,
			displayOptions: { show },
		});
	}

	// Path params
	const pathParamNames: Record<string, { field: string; locator: boolean }> = {};
	for (const param of primary.pathParams) {
		const locatorKey = override?.pathLocators?.[param.name];
		if (locatorKey) {
			const locator = locators[locatorKey];
			pathParamNames[param.name] = { field: locator.fieldName, locator: true };
			topLevel.push({
				...locatorProperty(locatorKey, undefined, undefined),
				required: true,
				displayOptions: { show },
			});
			manifestFields.push({
				container: '',
				name: locator.fieldName,
				kind: 'locator',
				target: 'path',
				property: param.name,
				required: true,
			});
		} else {
			const isOwnId =
				/^(id|[a-z]+Id|[a-z-]+-id)$/.test(param.name) || param.name === resource.singular;
			const field =
				isOwnId && param.name === resource.singular
					? `${resource.singular}Id`
					: camelCase(param.name);
			const displayName =
				override?.pathDisplayNames?.[param.name] ??
				(param.name === resource.singular
					? `${titleCase(resource.singular)} ID`
					: titleCase(param.name));
			pathParamNames[param.name] = { field, locator: false };
			const description = cleanDescription(param.description) ?? `ID of the ${resource.singular}`;
			if (param.schema.enum) {
				// Some enums repeat a value in another case (FAILURE / failure): keep the first.
				const seen = new Set<string>();
				const options = param.schema.enum
					.map(String)
					.filter((v) => !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
					.map((v) => ({ name: titleCase(v), value: v }))
					.sort((a, b) => a.name.localeCompare(b.name));
				topLevel.push({
					displayName,
					name: field,
					type: 'options',
					required: true,
					options,
					default: options[0].value,
					description,
					displayOptions: { show },
				});
				manifestFields.push({
					container: '',
					name: field,
					kind: 'options',
					target: 'path',
					property: param.name,
					required: true,
					options: options.map((o) => o.value),
				});
			} else {
				topLevel.push({
					displayName,
					name: field,
					type: 'string',
					required: true,
					default: '',
					placeholder: 'e.g. 123',
					description,
					displayOptions: { show },
				});
				manifestFields.push({
					container: '',
					name: field,
					kind: 'string',
					target: 'path',
					property: param.name,
					required: true,
				});
			}
		}
	}

	// Body. A oneOf body whose variants are told apart by a single-value `_type` (e.g. a
	// location is a building, folder or location) gets a Type selector, and each field
	// is shown for the variants that have it.
	const DISCRIMINATOR = '_type';
	const discriminatorField = 'objectType';
	const variants: Array<{ key?: string; schema: Schema; show: Record<string, unknown> }> = [];
	const oneOf = primary.body?.oneOf;
	if (primary.body?.properties) {
		variants.push({ schema: primary.body, show });
	} else if (oneOf?.length === 1) {
		variants.push({ schema: oneOf[0], show });
	} else if (oneOf?.length) {
		const values = oneOf.map((v) => v.properties?.[DISCRIMINATOR]?.enum);
		if (values.every((v) => v?.length === 1)) {
			const options = values
				.map((v) => String(v![0]))
				.map((value) => ({ name: titleCase(value), value }))
				.sort((a, b) => a.name.localeCompare(b.name));
			topLevel.push({
				displayName: 'Type',
				name: discriminatorField,
				type: 'options',
				noDataExpression: true,
				required: true,
				options,
				default: options[0].value,
				description: `Kind of ${resource.singular}`,
				routing: { send: { type: 'body', property: DISCRIMINATOR } },
				displayOptions: { show },
			});
			oneOf.forEach((schema, i) => {
				const key = String(values[i]![0]);
				variants.push({ key, schema, show: { ...show, [discriminatorField]: [key] } });
				manifestFields.push({
					container: '',
					name: discriminatorField,
					kind: 'options',
					target: 'body',
					property: DISCRIMINATOR,
					required: true,
					options: [key],
					variant: key,
				});
			});
		} else {
			problem(`${resource.tag} ${primary.operationId}: oneOf body without a single-value _type`);
		}
	} else if (primary.body && primary.method !== 'post') {
		problem(`${resource.tag} ${primary.operationId}: body without properties isn't supported`);
	}

	const isUpdate = meta.value === 'update';
	const container = isUpdate ? 'updateFields' : 'additionalFields';
	const containerLabel = isUpdate ? 'Update Fields' : 'Additional Fields';
	for (const variant of variants) {
		const required = new Set(variant.schema.required ?? []);
		for (const [prop, schema] of Object.entries(variant.schema.properties ?? {})) {
			if (schema.readOnly) continue;
			if (variant.key && prop === DISCRIMINATOR) continue;
			const fo = fieldOverride(resource, override, prop);
			if (fo.skip) continue;
			// Constants (single-value enums) are always sent, so they never sit in a collection.
			const isConstant = schema.enum?.length === 1 && !fo.options;
			// The spec's `required` is honoured on Update too: some PATCH schemas demand fields.
			const isRequired = isConstant || required.has(prop);
			const built = buildValueFields(
				prop,
				schema,
				'body',
				isRequired ? '' : container,
				isRequired,
				fo,
				ctx,
			);
			for (const { property, manifest } of built) {
				manifestFields.push(variant.key ? { ...manifest, variant: variant.key } : manifest);
				if (isRequired) {
					const helper = manifest.target === 'none';
					topLevel.push({
						...property,
						...(helper ? {} : { required: true }),
						displayOptions: { show: variant.show },
					});
				} else {
					addToCollection(
						container,
						containerLabel,
						'Add Field',
						property,
						variant.key ? { key: variant.key, show: variant.show } : undefined,
					);
				}
			}
		}
	}

	// Query params (union across merged variants)
	const queryByName = new Map<string, { param: Param; operationIds: string[] }>();
	for (const op of ops) {
		for (const param of op.queryParams) {
			const entry = queryByName.get(param.name) ?? { param, operationIds: [] };
			entry.operationIds.push(op.operationId);
			queryByName.set(param.name, entry);
		}
	}
	// The n8n field a query param becomes, and which spelling wins when two collide:
	// date_min_/date_max_ (the docs' date ranges) > s_/sc_ filter syntax > anything else.
	const queryFieldName = (param: Param): string => {
		const fo = fieldOverride(resource, override, param.name);
		const key =
			fo.locator === null
				? undefined
				: (fo.locator ?? (primaryType(param.schema) === 'array' ? undefined : propertyLocators[param.name]));
		return fo.name ?? (key ? locators[key].fieldName : filterName(param.name));
	};
	const rank = (name: string) => (/^date_(min|max)_/.test(name) ? 2 : /^(s|sc)_/.test(name) ? 1 : 0);
	const preferredByField = new Map<string, Param>();
	for (const { param } of queryByName.values()) {
		const field = queryFieldName(param);
		const current = preferredByField.get(field);
		if (!current || rank(param.name) > rank(current.name)) preferredByField.set(field, param);
	}

	const allowedQuery = new Set<string>();
	// A GET that documents both limit and page paginates, whatever its path or shape.
	const documentsPaging = ['limit', 'page'].every((n) =>
		primary.queryParams.some((q) => q.name === n),
	);
	const isListOp =
		override?.list === true ||
		(override?.list !== false &&
			primary.method === 'get' &&
			((primary.returns === 'records' && !/\}$/.test(primary.path)) || documentsPaging));
	for (const { param, operationIds } of queryByName.values()) {
		const fo = fieldOverride(resource, override, param.name);
		if (fo.skip || param.deprecated) continue;
		// Return All / Limit already send these.
		if (isListOp && (param.name === 'limit' || param.name === 'page')) continue;
		// Some endpoints document one filter in two styles (`code` and `s_code`,
		// `materialTypeId` and `s_material_type_id`): keep only the preferred one.
		if (preferredByField.get(queryFieldName(param))?.name !== param.name) continue;
		const isOption = apiRules.optionParams.includes(param.name);
		const container = isOption ? 'options' : 'filters';
		// Plain equality filters get the API-wide prefix; date ranges, options and
		// bracketed names (filter[...]) are sent as-is.
		const isPlainFilter =
			!isOption &&
			/^[a-z_]+$/.test(param.name) &&
			!/^(s|sc)_|^date_(min|max)_/.test(param.name) &&
			param.schema.format !== 'date-time';
		const sentName = isPlainFilter ? `${apiRules.filterPrefix}${param.name}` : param.name;
		const isLocator =
			fo.locator !== null &&
			Boolean(fo.locator ?? (primaryType(param.schema) === 'array' ? undefined : propertyLocators[param.name]));
		const schema = { ...param.schema, description: param.schema.description ?? param.description };
		const built = buildValueFields(
			sentName,
			schema,
			'query',
			container,
			false,
			{
				...fo,
				// Label and name follow the spec's param, not the prefixed name actually sent.
				// Locators keep their own label and name.
				...(isLocator
					? {}
					: {
							displayName: fo.displayName ?? filterLabel(param.name),
							name: fo.name ?? filterName(param.name),
						}),
			},
			ctx,
		);
		const showFor =
			selector && operationIds.length < ops.length
				? operationIds.map((id) => selector.byOperationId[id])
				: undefined;
		for (const { property, manifest } of built) {
			allowedQuery.add(String(manifest.property));
			manifestFields.push({ ...manifest, ...(showFor ? { showFor } : {}) });
			addToCollection(
				container,
				isOption ? 'Options' : 'Filters',
				isOption ? 'Add Option' : 'Add Filter',
				showFor
					? { ...property, displayOptions: { show: { [`/${selector!.name}`]: showFor } } }
					: property,
			);
		}
	}

	// Pagination for list operations
	const isList = isListOp;
	if (isList) {
		topLevel.push(raw(`...returnAllAndLimitFields(${JSON.stringify(show)})`));
		allowedQuery.add('limit').add('page');
	}

	// Two spec properties mapping to one n8n name would silently overwrite each other.
	const namesByContainer = new Map<string, string[]>();
	for (const f of manifestFields) {
		if (f.variant && f.name === discriminatorField) continue;
		const scope = `${f.container}|${f.variant ?? ''}`;
		const list = namesByContainer.get(scope) ?? [];
		if (list.includes(f.name)) {
			problem(
				`${resource.value}.${meta.value}: two fields named "${f.name}" in ${f.container || 'top level'} (add a name override)`,
			);
		}
		namesByContainer.set(scope, [...list, f.name]);
	}

	// Collections
	for (const [, collection] of Object.entries(collections).sort(([a], [b]) => a.localeCompare(b))) {
		topLevel.push({
			displayName: collection.displayName,
			name: collection.name,
			type: 'collection',
			placeholder: collection.placeholder,
			default: {},
			displayOptions: { show: collection.show },
			options: sortByDisplayName(collection.items),
		});
	}

	// Output
	const output: ManifestOperation['output'] =
		primary.method === 'delete'
			? 'deleted'
			: primary.returns === 'other' && !isList && !override?.returnsRecords
				? 'success'
				: 'records';
	const postReceive =
		output === 'records'
			? [raw('unwrapJsonApi')]
			: [
					{
						type: 'set',
						properties: {
							value:
								output === 'deleted' ? '={{ { "deleted": true } }}' : '={{ { "success": true } }}',
						},
					},
				];

	const url = selector
		? `=${'{{'} ({${ops
				.map(
					(op) =>
						`${JSON.stringify(selector.byOperationId[op.operationId])}: ${JSON.stringify(op.path)}`,
				)
				.join(', ')}})[$parameter.${selector.name}] }}`
		: urlExpression(primary.path, pathParamNames);

	const option = {
		name: meta.name,
		value: meta.value,
		action: meta.action,
		description: meta.description,
		routing: { request: { method: primary.method.toUpperCase(), url }, output: { postReceive } },
	};

	const baseManifests: ManifestOperation[] = ops.map((op) => ({
		resource: resource.value,
		operation: meta.value,
		operationId: op.operationId,
		method: op.method.toUpperCase(),
		path: op.path,
		output,
		list: isList,
		...(selector
			? { selector: { name: selector.name, value: selector.byOperationId[op.operationId] } }
			: {}),
		fields: manifestFields.filter(
			(f) => !f.showFor || !selector || f.showFor.includes(selector.byOperationId[op.operationId]),
		),
		allowedQuery: [...allowedQuery].sort(),
		...(variants.length === 1 ? { bodySchema: variants[0].schema } : {}),
	}));
	// One manifest entry per body variant, each checked against its own schema.
	const variantKeys = variants.map((v) => v.key).filter((k): k is string => Boolean(k));
	const manifests: ManifestOperation[] =
		variantKeys.length === 0
			? baseManifests.map((m) => ({ ...m, fields: m.fields.filter((f) => !f.variant) }))
			: baseManifests.flatMap((m) =>
					variants.map((v) => ({
						...m,
						variant: v.key,
						fields: m.fields.filter((f) => !f.variant || f.variant === v.key),
						bodySchema: v.schema,
					})),
				);

	if (output === 'records') {
		topLevel.push({
			displayName: 'Simplify',
			name: 'simplify',
			type: 'boolean',
			default: true,
			description:
				'Whether to return a flat object (ID plus attributes) instead of the raw JSON:API record',
			displayOptions: { show },
		});
	}

	return { value: meta.value, option, properties: topLevel, manifests };
}

// ─── Resource building & emission ────────────────────────────────────────────

function serialize(value: unknown): string {
	if (value instanceof Raw) return value.code;
	if (Array.isArray(value)) return `[${value.map(serialize).join(', ')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${serialize(v)}`)
			.join(', ')}}`;
	}
	if (typeof value === 'string') {
		// Placeholders for shared runtime expressions defined in shared/utils.ts.
		const placeholders: Record<string, string> = {
			'={{ RESOURCE_LOCATOR_ID }}': 'resourceLocatorIdExpression',
			'={{ INFRASPEAK_DATE }}': 'toInfraspeakDateExpression',
			'={{ ISO_DATE }}': 'toIsoDateExpression',
			'={{ INT_ARRAY }}': 'intArrayExpression',
			'={{ STRING_ARRAY }}': 'stringArrayExpression',
			'={{ JSON_VALUE }}': 'jsonValueExpression',
		};
		return placeholders[value] ?? JSON.stringify(value);
	}
	return JSON.stringify(value);
}

function buildResource(resource: ResourceConfig, all: SpecOperation[]) {
	const tagOps = all.filter(
		(op) => op.tag === resource.tag && (!resource.paths || resource.paths.test(op.path)),
	);
	if (tagOps.length === 0) fail(`No operations found for tag "${resource.tag}" (${resource.value})`);

	const variantIds = new Set(Object.keys(resource.listVariants?.variants ?? {}));
	const built: BuiltOperation[] = [];

	if (resource.listVariants) {
		const ordered = [...variantIds].map(
			(id) =>
				tagOps.find((op) => op.operationId === id) ??
				fail(`listVariants: unknown operationId ${id}`),
		);
		const byOperationId = Object.fromEntries(
			Object.entries(resource.listVariants.variants).map(([id, v]) => [id, v.value]),
		);
		built.push(
			buildOperation(resource, ordered, {
				name: resource.listVariants.selector.name,
				byOperationId,
			}),
		);
	}

	for (const op of tagOps) {
		if (variantIds.has(op.operationId)) continue;
		const override = resource.operations?.[op.operationId];
		if (override?.skip) continue;
		if (op.deprecated && !override) continue;
		built.push(buildOperation(resource, [op]));
	}

	const values = built.map((b) => b.value);
	const duplicate = values.find((v, i) => values.indexOf(v) !== i);
	if (duplicate) {
		const ids = built.filter((b) => b.value === duplicate).map((b) => b.manifests[0].operationId);
		problem(`${resource.tag}: ${ids.join(' and ')} both map to "${duplicate}" (add a value override)`);
	}

	const options = [...built].sort((a, b) =>
		String(a.option.name).localeCompare(String(b.option.name)),
	);
	const defaultOp = values.includes('getAll') ? 'getAll' : options[0].value;

	const operationProperty = {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource.value] } },
		options: options.map((b) => b.option),
		default: defaultOp,
	};

	const properties = [operationProperty, ...built.flatMap((b) => b.properties)];
	const body = serialize(dropRedundantDescriptions(properties));
	const utils = [
		'intArrayExpression',
		'jsonValueExpression',
		'resourceLocatorIdExpression',
		'stringArrayExpression',
		'toIsoDateExpression',
		'toInfraspeakDateExpression',
		'unwrapJsonApi',
	].filter((name) => new RegExp(`\\b${name}\\b`).test(body));
	const source = [
		`import type { INodeProperties } from 'n8n-workflow';`,
		...(body.includes('returnAllAndLimitFields(')
			? [`import { returnAllAndLimitFields } from '../shared/pagination';`]
			: []),
		...(utils.length ? [`import { ${utils.join(', ')} } from '../shared/utils';`] : []),
		'',
		`export const ${resource.value}Description: INodeProperties[] = ${body};`,
	].join('\n');

	return { source, manifests: built.flatMap((b) => b.manifests) };
}

async function main() {
	const { operations, sha256 } = loadSpec();
	const prettierConfig = (await resolveConfig(join(process.cwd(), RESOURCES_DIR, 'x.ts'))) ?? {};
	const header = (what: string) =>
		`// Generated by scripts/generate from the Infraspeak OpenAPI spec (sha256 ${sha256.slice(0, 12)}).\n// Do not edit: change scripts/generate/overrides.ts and run \`npm run generate\`.\n// ${what}\n`;

	const manifest: ManifestOperation[] = [];
	const sorted = [...resources].sort((a, b) => a.displayName.localeCompare(b.displayName));
	const files: Array<{ name: string; source: string }> = [];
	for (const resource of sorted) {
		const { source, manifests } = buildResource(resource, operations);
		files.push({ name: `${resource.value}.ts`, source: header(`Resource: ${resource.displayName}`) + source });
		manifest.push(...manifests);
	}

	// Split tags: every active operation of an enabled tag must belong to some resource.
	for (const tag of new Set(resources.map((r) => r.tag))) {
		const owners = resources.filter((r) => r.tag === tag);
		for (const op of operations.filter((o) => o.tag === tag && !o.deprecated)) {
			const claimed = owners.filter((r) => !r.paths || r.paths.test(op.path));
			if (claimed.length === 0) {
				problem(`${tag} ${op.operationId} (${op.path}) isn't in any resource (check \`paths\`)`);
			} else if (claimed.length > 1) {
				problem(
					`${tag} ${op.operationId} (${op.path}) is in ${claimed.map((r) => r.value).join(' and ')}`,
				);
			}
		}
	}

	if (problems.length > 0) {
		fail(`${problems.length} problem(s), nothing written:\n  - ${problems.join('\n  - ')}`);
	}

	// Clean previously generated resource files (hand-written files don't carry the header).
	mkdirSync(RESOURCES_DIR, { recursive: true });
	for (const entry of readdirSync(RESOURCES_DIR, { withFileTypes: true })) {
		rmSync(join(RESOURCES_DIR, entry.name), { recursive: true, force: true });
	}
	for (const file of files) {
		writeFileSync(
			join(RESOURCES_DIR, file.name),
			await format(file.source, { ...prettierConfig, parser: 'typescript' }),
		);
	}

	const index = [
		header('All enabled resources.'),
		`import type { INodeProperties } from 'n8n-workflow';`,
		...sorted.map((r) => `import { ${r.value}Description } from './${r.value}';`),
		'',
		`export const resourceProperties: INodeProperties[] = ${serialize([
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: sorted.map((r) => ({ name: r.displayName, value: r.value })),
				default: sorted.find((r) => r.value === 'failure')?.value ?? sorted[0].value,
			},
			...sorted.map((r) => raw(`...${r.value}Description`)),
		])};`,
	].join('\n');
	writeFileSync(
		join(RESOURCES_DIR, 'index.ts'),
		await format(index, { ...prettierConfig, parser: 'typescript' }),
	);

	mkdirSync('test/generated', { recursive: true });
	writeFileSync(
		MANIFEST_PATH,
		await format(JSON.stringify({ specSha256: sha256, operations: manifest }), {
			...prettierConfig,
			parser: 'json',
		}),
	);

	const opCount = new Set(manifest.map((m) => `${m.resource}.${m.operation}`)).size;
	console.log(
		`Generated ${sorted.length} resources, ${opCount} operations (${manifest.length} endpoints).`,
	);
}

main().catch((error: unknown) => {
	console.error(error instanceof GeneratorError ? `generate: ${error.message}` : error);
	process.exit(1);
});
