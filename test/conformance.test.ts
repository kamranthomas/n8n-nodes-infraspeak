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
import type { IDataObject } from 'n8n-workflow';
import { BASE_URL, runNode, useNock } from './harness';
import { build, label, operations, type Operation } from './manifest';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv, ['uuid', 'date']);
// The spec declares date-time fields, but the API takes `YYYY-MM-DD HH:MM:SS`
// (docs/api/README.md), which is what the node sends.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

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
