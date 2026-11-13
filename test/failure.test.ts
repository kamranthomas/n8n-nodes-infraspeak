import nock from 'nock';
import { BASE_URL, runNode, useNock } from './harness';

const record = (id: number, extra: Record<string, unknown> = {}) => ({
	id: String(id),
	type: 'failure',
	attributes: { failure_id: id, ...extra },
	relationships: {},
});

const page = (from: number, count: number) => ({
	data: Array.from({ length: count }, (_, i) => record(from + i)),
	meta: { pagination: { count, per_page: 200 } },
});

const api = () => nock(BASE_URL);

describe('Failure (v1, hand-written)', () => {
	useNock({ assertAllUsed: true });

	describe('Get', () => {
		it('simplifies to { id, ...attributes }', async () => {
			api()
				.get('/v3/failures/7')
				.reply(200, { data: record(7, { priority: 3 }) });
			const { items, error } = await runNode({
				resource: 'failure',
				operation: 'get',
				failureId: '7',
				simplify: true,
			});
			expect(error).toBeUndefined();
			expect(items.map((i) => i.json)).toEqual([{ id: '7', failure_id: 7, priority: 3 }]);
		});

		it('returns the raw JSON:API record when Simplify is off', async () => {
			api()
				.get('/v3/failures/7')
				.reply(200, { data: record(7) });
			const { items } = await runNode({
				resource: 'failure',
				operation: 'get',
				failureId: '7',
				simplify: false,
			});
			expect(items[0].json).toEqual(record(7));
		});

		it('accepts a UUID and URL-encodes the path', async () => {
			const uuid = '0b5f2c1e-8d1a-4c5e-9f4b-1a2b3c4d5e6f';
			api()
				.get(`/v3/failures/${uuid}`)
				.reply(200, { data: record(1) });
			const { error } = await runNode({
				resource: 'failure',
				operation: 'get',
				failureId: uuid,
				simplify: true,
			});
			expect(error).toBeUndefined();
		});
	});

	describe('Create', () => {
		it('sends resource-locator IDs and numbers as integers in a flat JSON body', async () => {
			let body: unknown;
			api()
				.post('/v3/failures', (b) => {
					body = b;
					return true;
				})
				.reply(200, { data: record(99) });

			const { error, items } = await runNode({
				resource: 'failure',
				operation: 'create',
				clientId: { __rl: true, mode: 'list', value: '12' },
				locationId: { __rl: true, mode: 'id', value: '34' },
				// UI-only helper that narrows the Problem Type list: must not be sent.
				problemAreaId: { __rl: true, mode: 'list', value: '5' },
				problemId: { __rl: true, mode: 'list', value: '56' },
				priority: 3,
				additionalFields: {
					description: 'Light out',
					reportType: 'contact',
					enforceNfc: true,
				},
				simplify: true,
			});

			expect(error).toBeUndefined();
			expect(body).toEqual({
				client_id: 12,
				local_id: 34,
				problem_id: 56,
				priority: 3,
				description: 'Light out',
				report_type: 'contact',
				enforce_nfc: true,
			});
			expect(items[0].json.id).toBe('99');
		});

		it('sends a non-numeric locator value unchanged instead of null', async () => {
			let body: unknown;
			api()
				.post('/v3/failures', (b) => {
					body = b;
					return true;
				})
				.reply(200, { data: record(99) });

			const { error } = await runNode({
				resource: 'failure',
				operation: 'create',
				clientId: { __rl: true, mode: 'list', value: 'not-an-id' },
				locationId: { __rl: true, mode: 'id', value: '34' },
				problemId: { __rl: true, mode: 'id', value: '56' },
				priority: 1,
				simplify: true,
			});

			expect(error).toBeUndefined();
			expect(body).toEqual({ client_id: 'not-an-id', local_id: 34, problem_id: 56, priority: 1 });
		});
	});

	describe('Update', () => {
		it('PATCHes only the fields that were set, including locators inside the collection', async () => {
			let body: unknown;
			api()
				.patch('/v3/failures/7', (b) => {
					body = b;
					return true;
				})
				.reply(200, { data: record(7) });

			const { error } = await runNode({
				resource: 'failure',
				operation: 'update',
				failureId: '7',
				updateFields: {
					priority: 4,
					locationId: { __rl: true, mode: 'list', value: '88' },
					lastStatusDescription: 'Fixed',
				},
				simplify: true,
			});

			expect(error).toBeUndefined();
			expect(body).toEqual({ priority: 4, local_id: 88, last_status_description: 'Fixed' });
		});
	});

	describe('Get Many', () => {
		it.each([
			['all', '/v3/failures'],
			['open', '/v3/failures/open'],
			['closed', '/v3/failures/closed'],
		])('status group %s calls %s with limit and page=1', async (statusGroup, path) => {
			api().get(path).query({ limit: '5', page: '1' }).reply(200, page(1, 5));
			const { items, error } = await runNode({
				resource: 'failure',
				operation: 'getAll',
				statusGroup,
				returnAll: false,
				limit: 5,
				simplify: true,
			});
			expect(error).toBeUndefined();
			expect(items).toHaveLength(5);
		});

		it('Return All pages 200 at a time and stops on a short page', async () => {
			api().get('/v3/failures').query({ limit: '200', page: '1' }).reply(200, page(1, 200));
			api().get('/v3/failures').query({ limit: '200', page: '2' }).reply(200, page(201, 200));
			api().get('/v3/failures').query({ limit: '200', page: '3' }).reply(200, page(401, 3));

			const { items, error } = await runNode({
				resource: 'failure',
				operation: 'getAll',
				statusGroup: 'all',
				returnAll: true,
				simplify: true,
			});

			expect(error).toBeUndefined();
			expect(items).toHaveLength(403);
			expect(items[402].json.id).toBe('403');
		});

		it('sends filters, converting dates to YYYY-MM-DD HH:MM:SS', async () => {
			api()
				.get('/v3/failures/open')
				.query({
					limit: '50',
					page: '1',
					status: 'PAUSED',
					local_id: '34',
					problem_id: '56',
					date_min_start_date: '2026-01-01 08:30:00',
				})
				.reply(200, page(1, 1));

			const { error } = await runNode({
				resource: 'failure',
				operation: 'getAll',
				statusGroup: 'open',
				returnAll: false,
				limit: 50,
				filters: {
					status: 'PAUSED',
					locationId: { __rl: true, mode: 'id', value: '34' },
					problemId: 56,
					reportedAfter: '2026-01-01T08:30:00',
				},
				simplify: true,
			});
			expect(error).toBeUndefined();
		});

		it('returns no items for an empty list', async () => {
			api().get('/v3/failures').query(true).reply(200, { data: [] });
			const { items, error } = await runNode({
				resource: 'failure',
				operation: 'getAll',
				statusGroup: 'all',
				returnAll: false,
				limit: 50,
				simplify: true,
			});
			expect(error).toBeUndefined();
			expect(items).toEqual([]);
		});
	});
});
