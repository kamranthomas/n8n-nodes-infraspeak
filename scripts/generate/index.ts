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
	return sentence.trim().replace(/\.$/, '') || undefined;
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
const fail = (message: string): never => {
	throw new GeneratorError(message);
};

// ─── Manifest (what the conformance tests check) ─────────────────────────────

/** How a field's value is turned into the request. Mirrors the runtime expressions. */
type ValueKind = 'string' | 'number' | 'boolean' | 'options' | 'date' | 'intArray' | 'locator';

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
	const locatorKey =
		override.locator === null ? undefined : (override.locator ?? propertyLocators[prop]);
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

	const name = override.name ?? camelCase(prop);
	const displayName = override.displayName ?? titleCase(prop);
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

	if (schema.enum || override.options) {
		const options =
			override.options ??
			(schema.enum ?? []).map((v) => ({ name: titleCase(String(v)), value: v }));
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
			if (schema.format === 'date-time') {
				return [
					{
						property: {
							...base,
							type: 'dateTime',
							default: '',
							routing: send(prop, '={{ INFRASPEAK_DATE }}'),
						},
						manifest: manifest('date'),
					},
				];
			}
			const multiline = override.multiline ?? false;
			return [
				{
					property: {
						...base,
						type: 'string',
						default: '',
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
				fail(
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
			if (itemType !== 'integer') {
				fail(
					`${where}: arrays of ${itemType} aren't supported yet (add support or skip the field)`,
				);
			}
			return [
				{
					property: {
						...base,
						type: 'string',
						default: '',
						placeholder: 'e.g. 1, 2, 3',
						routing: send(prop, '={{ INT_ARRAY }}'),
					},
					manifest: manifest('intArray'),
				},
			];
		}
		default:
			return fail(`${where}: unsupported schema type ${JSON.stringify(schema.type)}`);
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
		if (op.method === 'get' && op.returns === 'records' && !hasTrailingParam)
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
		return fail(
			`${resource.tag} ${op.operationId} (${op.method.toUpperCase()} ${op.path}) isn't plain CRUD: add value/name/action overrides`,
		);
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
	const collections: Record<
		string,
		{ displayName: string; placeholder: string; items: Array<Record<string, unknown>> }
	> = {};
	const manifestFields: ManifestField[] = [];
	const addToCollection = (
		container: string,
		displayName: string,
		placeholder: string,
		property: Record<string, unknown>,
	) => {
		collections[container] ??= { displayName, placeholder, items: [] };
		collections[container].items.push(property);
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
			topLevel.push({
				displayName,
				name: field,
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 123',
				description: cleanDescription(param.description) ?? `ID of the ${resource.singular}`,
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

	// Body
	if (primary.body?.properties) {
		const required = new Set(primary.body.required ?? []);
		const isUpdate = meta.value === 'update';
		const container = isUpdate ? 'updateFields' : 'additionalFields';
		const containerLabel = isUpdate ? 'Update Fields' : 'Additional Fields';
		for (const [prop, schema] of Object.entries(primary.body.properties)) {
			if (schema.readOnly) continue;
			const fo = fieldOverride(resource, override, prop);
			if (fo.skip) continue;
			const isRequired = !isUpdate && required.has(prop);
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
				manifestFields.push(manifest);
				if (isRequired) {
					const helper = manifest.target === 'none';
					topLevel.push({
						...property,
						...(helper ? {} : { required: true }),
						displayOptions: { show },
					});
				} else {
					addToCollection(container, containerLabel, 'Add Field', property);
				}
			}
		}
	} else if (primary.body && primary.method !== 'post') {
		fail(`${resource.tag} ${primary.operationId}: body without properties isn't supported`);
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
	const allowedQuery = new Set<string>();
	for (const { param, operationIds } of queryByName.values()) {
		const fo = fieldOverride(resource, override, param.name);
		if (fo.skip) continue;
		const isOption = apiRules.optionParams.includes(param.name);
		const container = isOption ? 'options' : 'filters';
		// Plain equality filters get the API-wide prefix; date ranges, options and
		// bracketed names (filter[...]) are sent as-is.
		const isPlainFilter =
			!isOption && /^[a-z_]+$/.test(param.name) && param.schema.format !== 'date-time';
		const sentName = isPlainFilter ? `${apiRules.filterPrefix}${param.name}` : param.name;
		const schema = { ...param.schema, description: param.schema.description ?? param.description };
		const built = buildValueFields(
			sentName,
			schema,
			'query',
			container,
			false,
			{
				...fo,
				displayName:
					fo.displayName ?? (sentName === param.name ? undefined : titleCase(param.name)),
				name: fo.name ?? (sentName === param.name ? undefined : camelCase(param.name)),
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
	const isList =
		primary.method === 'get' && primary.returns === 'records' && !/\}$/.test(primary.path);
	if (isList) {
		topLevel.push(raw(`...returnAllAndLimitFields(${JSON.stringify(show)})`));
		allowedQuery.add('limit').add('page');
	}

	// Collections
	for (const [name, collection] of Object.entries(collections).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		topLevel.push({
			displayName: collection.displayName,
			name,
			type: 'collection',
			placeholder: collection.placeholder,
			default: {},
			displayOptions: { show },
			options: sortByDisplayName(collection.items),
		});
	}

	// Output
	const output: ManifestOperation['output'] =
		primary.method === 'delete' ? 'deleted' : primary.returns === 'other' ? 'success' : 'records';
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

	const manifests: ManifestOperation[] = ops.map((op) => ({
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
		...(primary.body?.properties ? { bodySchema: primary.body } : {}),
	}));

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
			'={{ INT_ARRAY }}': 'intArrayExpression',
		};
		return placeholders[value] ?? JSON.stringify(value);
	}
	return JSON.stringify(value);
}

function buildResource(resource: ResourceConfig, all: SpecOperation[]) {
	const tagOps = all.filter((op) => op.tag === resource.tag);
	if (tagOps.length === 0) fail(`No operations found for tag "${resource.tag}"`);

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
	if (duplicate)
		fail(`${resource.tag}: two operations map to "${duplicate}" (add a value override)`);

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
		'resourceLocatorIdExpression',
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

	// Clean previously generated resource files (hand-written files don't carry the header).
	mkdirSync(RESOURCES_DIR, { recursive: true });
	for (const entry of readdirSync(RESOURCES_DIR, { withFileTypes: true })) {
		rmSync(join(RESOURCES_DIR, entry.name), { recursive: true, force: true });
	}

	const manifest: ManifestOperation[] = [];
	const sorted = [...resources].sort((a, b) => a.displayName.localeCompare(b.displayName));
	for (const resource of sorted) {
		const { source, manifests } = buildResource(resource, operations);
		const formatted = await format(header(`Resource: ${resource.displayName}`) + source, {
			...prettierConfig,
			parser: 'typescript',
		});
		writeFileSync(join(RESOURCES_DIR, `${resource.value}.ts`), formatted);
		manifest.push(...manifests);
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
