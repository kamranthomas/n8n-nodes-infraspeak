/**
 * The generated manifest (test/generated/manifest.json) and how to turn one of its
 * operations into node parameters plus the request the node should send. Shared by
 * the conformance tests (HTTP mocked) and the mock-server test (Prism).
 */
import type { IDataObject, INodeParameters } from 'n8n-workflow';
import manifestJson from './generated/manifest.json';

export type Kind =
	| 'string'
	| 'number'
	| 'boolean'
	| 'options'
	| 'date'
	| 'intArray'
	| 'stringArray'
	| 'json'
	| 'locator';

export interface JsonSchema {
	type?: string | string[];
	format?: string;
	enum?: unknown[];
	items?: JsonSchema;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	minItems?: number;
	oneOf?: JsonSchema[];
}

export interface Field {
	container: string;
	name: string;
	kind: Kind;
	target: 'body' | 'query' | 'path' | 'none';
	property?: string;
	required: boolean;
	options?: Array<string | number>;
	format?: string;
	schema?: JsonSchema;
	arrayItems?: string;
	dateFormat?: 'iso';
}

export interface Operation {
	resource: string;
	operation: string;
	operationId: string;
	method: string;
	path: string;
	output: 'records' | 'deleted' | 'success';
	list: boolean;
	selector?: { name: string; value: string };
	variant?: string;
	fields: Field[];
	allowedQuery: string[];
	bodySchema?: object;
}

export const operations = (manifestJson as { operations: Operation[] }).operations;

export const SAMPLE_DATE_INPUT = '2026-01-02T03:04:05';
export const SAMPLE_DATE_SENT = '2026-01-02 03:04:05';
export const SAMPLE_ID = '42';

/** Smallest value that satisfies a schema: required properties only, empty arrays. */
export function sampleFromSchema(schema: JsonSchema): unknown {
	if (schema.oneOf?.length) return sampleFromSchema(schema.oneOf[0]);
	if (schema.enum?.length) return schema.enum.find((v) => v !== null);
	const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
	switch (type) {
		case 'object':
			return Object.fromEntries(
				(schema.required ?? []).map((key) => [
					key,
					sampleFromSchema(schema.properties?.[key] ?? {}),
				]),
			);
		case 'array':
			return Array.from({ length: schema.minItems ?? 0 }, () =>
				sampleFromSchema(schema.items ?? {}),
			);
		case 'integer':
		case 'number':
			return 1;
		case 'boolean':
			return true;
		case 'string':
			return schema.format === 'date-time' ? SAMPLE_DATE_SENT : 'x';
		default:
			return null;
	}
}

/** Value to put in the n8n parameter, and the value expected on the wire. */
export function sample(field: Field): { input: unknown; sent: unknown } {
	switch (field.kind) {
		case 'string': {
			if (field.target === 'path') return { input: SAMPLE_ID, sent: SAMPLE_ID };
			const byFormat: Record<string, string> = {
				uuid: '0b5f2c1e-8d1a-4c5e-9f4b-1a2b3c4d5e6f',
				email: 'name@example.com',
				byte: 'aGVsbG8=',
			};
			const value =
				(field.format && byFormat[field.format]) ??
				(field.arrayItems === 'integer' ? '1' : `sample ${field.name}`);
			return { input: value, sent: value };
		}
		case 'number':
			return { input: 7, sent: 7 };
		case 'boolean':
			return { input: true, sent: true };
		case 'options':
			return { input: field.options![0], sent: field.options![0] };
		case 'date':
			return {
				input: SAMPLE_DATE_INPUT,
				sent: field.dateFormat === 'iso' ? SAMPLE_DATE_INPUT : SAMPLE_DATE_SENT,
			};
		case 'intArray':
			return { input: '1, 2', sent: [1, 2] };
		case 'stringArray':
			return { input: 'a, b', sent: ['a', 'b'] };
		case 'json': {
			const value = sampleFromSchema(field.schema ?? {});
			return { input: JSON.stringify(value), sent: value };
		}
		case 'locator':
			return {
				input: { __rl: true, mode: 'id', value: SAMPLE_ID },
				sent: field.target === 'path' ? SAMPLE_ID : Number(SAMPLE_ID),
			};
	}
}

export interface Expected {
	parameters: INodeParameters;
	path: string;
	query: Record<string, string>;
	body: IDataObject;
}

export function build(
	op: Operation,
	mode: 'all' | 'required',
	options: { skipOptionalDates?: boolean } = {},
): Expected {
	const parameters: INodeParameters = { resource: op.resource, operation: op.operation };
	const query: Record<string, string> = {};
	const body: IDataObject = {};
	let path = op.path;

	if (op.selector) parameters[op.selector.name] = op.selector.value;
	if (op.output === 'records') parameters.simplify = true;
	if (op.list) {
		parameters.returnAll = false;
		parameters.limit = 3;
		query.limit = '3';
		query.page = '1';
	}

	for (const field of op.fields) {
		if (mode === 'required' && !field.required) continue;
		if (options.skipOptionalDates && field.kind === 'date' && !field.required) continue;
		const { input, sent } = sample(field);
		if (field.container) {
			const collection = (parameters[field.container] ?? {}) as IDataObject;
			collection[field.name] = input as IDataObject[string];
			parameters[field.container] = collection as INodeParameters[string];
		} else {
			parameters[field.name] = input as INodeParameters[string];
		}
		if (field.target === 'body') body[field.property!] = sent as IDataObject[string];
		if (field.target === 'query') query[field.property!] = String(sent);
		if (field.target === 'path') path = path.replace(`{${field.property}}`, String(sent));
	}
	return { parameters, path, query, body };
}

export const label = (op: Operation) =>
	`${op.resource} → ${op.operation}${op.selector ? ` (${op.selector.value})` : ''}${op.variant ? ` <${op.variant}>` : ''} [${op.method} ${op.path}]`;
