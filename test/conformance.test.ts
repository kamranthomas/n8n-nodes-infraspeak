/**
 * Spec-conformance tests, generated from test/generated/manifest.json (written by
 * `npm run generate`). For every operation the node is executed through n8n's real
 * engine and the outgoing request is checked against the OpenAPI spec:
 *
 * - method and path match the spec's path template,
 * - query params are ones the spec (or the docs' pagination/date-range rules) allow,
 * - the body is exactly what the fields should produce, AND validates against the
 *   spec's request schema with ajv (an independent check of types/required props).
 *
 * This proves the node sends what the spec describes. It cannot prove the live API
 * behaves like the spec. That's the live suite's job.
 */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import nock from 'nock';
import type { IDataObject, INodeParameters } from 'n8n-workflow';
import manifestJson from './generated/manifest.json';
import { BASE_URL, runNode, useNock } from './harness';

type Kind = 'string' | 'number' | 'boolean' | 'options' | 'date' | 'intArray' | 'locator';

interface Field {
	container: string;
	name: string;
	kind: Kind;
	target: 'body' | 'query' | 'path' | 'none';
	property?: string;
	required: boolean;
	options?: Array<string | number>;
	format?: string;
}

interface Operation {
	resource: string;
	operation: string;
	operationId: string;
	method: string;
	path: string;
	output: 'records' | 'deleted' | 'success';
	list: boolean;
	selector?: { name: string; value: string };
	fields: Field[];
	allowedQuery: string[];
	bodySchema?: object;
}

const operations = (manifestJson as { operations: Operation[] }).operations;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv, ['uuid', 'date']);
// The spec declares date-time fields, but the API takes `YYYY-MM-DD HH:MM:SS`
// (docs/api/README.md), which is what the node sends.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

const SAMPLE_DATE_INPUT = '2026-01-02T03:04:05';
const SAMPLE_DATE_SENT = '2026-01-02 03:04:05';
const SAMPLE_ID = '42';

/** Value to put in the n8n parameter, and the value expected on the wire. */
function sample(field: Field): { input: unknown; sent: unknown } {
	switch (field.kind) {
		case 'string': {
			if (field.target === 'path') return { input: SAMPLE_ID, sent: SAMPLE_ID };
			const value =
				field.format === 'uuid' ? '0b5f2c1e-8d1a-4c5e-9f4b-1a2b3c4d5e6f' : `sample ${field.name}`;
			return { input: value, sent: value };
		}
		case 'number':
			return { input: 7, sent: 7 };
		case 'boolean':
			return { input: true, sent: true };
		case 'options':
			return { input: field.options![0], sent: field.options![0] };
		case 'date':
			return { input: SAMPLE_DATE_INPUT, sent: SAMPLE_DATE_SENT };
		case 'intArray':
			return { input: '1, 2', sent: [1, 2] };
		case 'locator':
			return {
				input: { __rl: true, mode: 'id', value: SAMPLE_ID },
				sent: field.target === 'path' ? SAMPLE_ID : Number(SAMPLE_ID),
			};
	}
}

interface Expected {
	parameters: INodeParameters;
	path: string;
	query: Record<string, string>;
	body: IDataObject;
}

function build(op: Operation, mode: 'all' | 'required'): Expected {
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

const record = (id: number) => ({
	id: String(id),
	type: 'record',
	attributes: { name: `record ${id}` },
	relationships: {},
});

function responseFor(op: Operation, count = 2) {
	if (op.output === 'deleted') return { data: [] };
	if (op.output === 'success') return { status: 'success', data: {} };
	if (op.list) return { data: Array.from({ length: count }, (_, i) => record(i + 1)) };
	return { data: record(1) };
}

interface Captured {
	method: string;
	path: string;
	query: Record<string, string>;
	body: unknown;
}

function intercept(op: Operation, response: object): Captured[] {
	const captured: Captured[] = [];
	nock(BASE_URL)
		.intercept(() => true, op.method)
		.query(true)
		.times(10)
		.reply(function (uri, requestBody) {
			const url = new URL(uri, BASE_URL);
			captured.push({
				method: this.req.method,
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				body: requestBody === '' ? undefined : requestBody,
			});
			return [200, response];
		});
	return captured;
}

const label = (op: Operation) =>
	`${op.resource} → ${op.operation}${op.selector ? ` (${op.selector.value})` : ''} [${op.method} ${op.path}]`;

describe('spec conformance', () => {
	useNock();

	it('the manifest covers every generated operation', () => {
		expect(operations.length).toBeGreaterThan(0);
	});

	describe.each(operations.map((op) => [label(op), op] as const))('%s', (_, op) => {
		it.each(['all', 'required'] as const)(
			'sends what the spec describes (%s fields)',
			async (mode) => {
				const expected = build(op, mode);
				const captured = intercept(op, responseFor(op));

				const { items, error } = await runNode(expected.parameters);

				expect(error).toBeUndefined();
				expect(captured).toHaveLength(1);
				const [request] = captured;

				expect(request.method).toBe(op.method);
				expect(request.path).toBe(`/v3${expected.path}`);
				expect(request.query).toEqual(expected.query);
				for (const key of Object.keys(request.query)) {
					expect(op.allowedQuery).toContain(key);
				}

				const sentBody = (request.body ?? {}) as IDataObject;
				expect(sentBody).toEqual(expected.body);
				if (op.bodySchema && Object.keys(sentBody).length > 0) {
					const validate = ajv.compile(op.bodySchema);
					const valid = validate(sentBody);
					expect(validate.errors ?? []).toEqual([]);
					expect(valid).toBe(true);
				}

				const output = items.map((i) => i.json);
				if (op.output === 'deleted') expect(output).toEqual([{ deleted: true }]);
				if (op.output === 'success') expect(output).toEqual([{ success: true }]);
				if (op.output === 'records') {
					expect(output.length).toBe(op.list ? 2 : 1);
					expect(output[0]).toEqual({ id: '1', name: 'record 1' });
				}
			},
		);

		if (op.list) {
			it('Return All pages until a short page', async () => {
				const pages = [
					{ data: Array.from({ length: 200 }, (_, i) => record(i + 1)) },
					{ data: [record(201)] },
				];
				const seen: string[] = [];
				nock(BASE_URL)
					.intercept(() => true, op.method)
					.query(true)
					.times(2)
					.reply(function (uri) {
						const page = new URL(uri, BASE_URL).searchParams.get('page');
						seen.push(String(page));
						return [200, pages[Number(page) - 1]];
					});

				const { parameters } = build(op, 'required');
				const { items, error } = await runNode({ ...parameters, returnAll: true });

				expect(error).toBeUndefined();
				expect(seen).toEqual(['1', '2']);
				expect(items).toHaveLength(201);
			});
		}
	});
});
