import {
	alternativeName,
	arrayEncodings,
	attributeOf,
	dateShape,
	dateVariants,
	judgeContains,
	judgeDate,
	judgeEquality,
	judgeIn,
	normalizeDate,
	pickDate,
	pickSearchTerm,
	pickTwoValues,
	pickValue,
	recordsOf,
	sameValue,
	toQueryString,
	valueOf,
	type ApiRecord,
} from '../scripts/verify/checks';

const rec = (
	id: string,
	attributes: Record<string, unknown>,
	extra: Partial<ApiRecord> = {},
): ApiRecord => ({
	id,
	attributes,
	...extra,
});

const clients = [
	rec('1', { name: 'Acme Lisbon', code: 'A1', active: true, created_at: '2026-01-01 10:00:00' }),
	rec('2', { name: 'Acme Porto', code: 'A2', active: true, created_at: '2026-02-01 10:00:00' }),
	rec('3', { name: 'Beta Faro', code: 'B1', active: false, created_at: '2026-03-01 10:00:00' }),
];

describe('reading records', () => {
	it('reads JSON:API data, bare arrays, and rejects non-lists', () => {
		const doc = { data: [{ id: 5, type: 'client', attributes: { name: 'x' } }] };
		expect(recordsOf(doc)).toEqual([
			{ id: '5', type: 'client', attributes: { name: 'x' }, relationships: undefined },
		]);
		expect(recordsOf([{ id: 1, name: 'y' }])?.[0].attributes.name).toBe('y');
		expect(recordsOf({ data: { id: 1 } })).toBeUndefined();
	});

	it('finds values in attributes, the id, or a relationship', () => {
		const r = rec('9', { code: 'Z' }, { relationships: { client: { data: { id: '77' } } } });
		expect(valueOf(r, 'code')).toBe('Z');
		expect(valueOf(r, 'id')).toBe('9');
		expect(valueOf(r, 'client_id')).toBe('77');
		expect(valueOf(r, 'missing')).toBeUndefined();
	});

	it('compares loosely', () => {
		expect(sameValue(1, '1')).toBe(true);
		expect(sameValue(true, '1')).toBe(true);
		expect(sameValue(false, 'false')).toBe(true);
		expect(sameValue('ABC', 'abc')).toBe(true);
		expect(sameValue('1', '2')).toBe(false);
	});
});

describe('param names', () => {
	it.each([
		['s_name_like', 'name'],
		['date_min_start_date', 'start_date'],
		['s_code_in', 'code'],
		['s_parent_id_notin', 'parent_id'],
		['sc_search', 'search'],
		['local_id', 'local_id'],
	])('%s targets %s', (param, attribute) => expect(attributeOf(param)).toBe(attribute));

	it('swaps bare and s_, but not sc_ or bracketed names', () => {
		expect(alternativeName('code')).toBe('s_code');
		expect(alternativeName('s_code')).toBe('code');
		expect(alternativeName('sc_search')).toBeUndefined();
		expect(alternativeName('filter[x]')).toBeUndefined();
	});
});

describe('picking probe values', () => {
	it('prefers a value that leaves records out', () => {
		expect(pickValue(clients, 'active')).toEqual({ value: true, observable: true });
		expect(pickValue([clients[0], clients[1]], 'active')).toEqual({
			value: true,
			observable: false,
		});
		expect(pickValue(clients, 'nope')).toBeUndefined();
	});

	it('picks two distinct values, a search word and a median date', () => {
		expect(pickTwoValues(clients, 'code')).toEqual(['A1', 'A2']);
		expect(pickTwoValues([clients[0]], 'code')).toBeUndefined();
		expect(pickSearchTerm(clients, 'name')).toBe('Acme');
		expect(pickDate(clients, 'created_at')).toBe('2026-02-01 10:00:00');
		expect(pickDate([clients[0]], 'created_at')).toBeUndefined();
	});
});

describe('verdicts', () => {
	it('equality', () => {
		expect(judgeEquality(200, [clients[0]], 'code', 'A1', true)).toBe('works');
		expect(judgeEquality(200, clients, 'code', 'A1', true)).toBe('ignored');
		expect(judgeEquality(400, undefined, 'code', 'A1', true)).toBe('rejected');
		expect(judgeEquality(200, [], 'code', 'A1', true)).toBe('empty');
		expect(judgeEquality(200, [clients[0]], 'code', 'A1', false)).toBe('inconclusive');
		expect(judgeEquality(200, [clients[0]], 'nope', 'A1', true)).toBe('inconclusive');
	});

	it('contains', () => {
		expect(judgeContains(200, clients.slice(0, 2), 'acme', 'name')).toBe('works');
		expect(judgeContains(200, clients, 'acme', 'name')).toBe('ignored');
		expect(judgeContains(200, clients, 'acme')).toBe('inconclusive');
		expect(judgeContains(422, undefined, 'acme')).toBe('rejected');
	});

	it('in and notin', () => {
		const two: [string, string] = ['A1', 'A2'];
		expect(judgeIn(200, clients.slice(0, 2), 'code', two, false)).toBe('works');
		expect(judgeIn(200, [clients[0]], 'code', two, false)).toBe('partial');
		expect(judgeIn(200, clients, 'code', two, false)).toBe('ignored');
		expect(judgeIn(200, [clients[2]], 'code', two, true)).toBe('works');
		expect(judgeIn(200, [clients[0], clients[2]], 'code', two, true)).toBe('partial');
		expect(judgeIn(200, clients, 'code', two, true)).toBe('ignored');
	});

	it('dates', () => {
		const pivot = '2026-02-01 10:00:00';
		expect(judgeDate(200, clients.slice(1), 'created_at', pivot, 'min')).toBe('works');
		expect(judgeDate(200, clients, 'created_at', pivot, 'min')).toBe('ignored');
		expect(judgeDate(200, clients.slice(0, 2), 'created_at', pivot, 'max')).toBe('works');
		expect(judgeDate(200, [rec('x', {})], 'created_at', pivot, 'min')).toBe('ignored');
		expect(judgeDate(422, undefined, 'created_at', pivot, 'min')).toBe('rejected');
	});
});

describe('formats', () => {
	it('normalizes and classifies dates', () => {
		expect(normalizeDate('2026-01-02T03:04:05+01:00')).toBe('2026-01-02 03:04:05');
		expect(normalizeDate('2026-01-02')).toBe('2026-01-02 00:00:00');
		expect(normalizeDate(5)).toBeUndefined();
		expect(dateShape('2026-01-02 03:04:05')).toBe('space');
		expect(dateShape('2026-01-02T03:04:05')).toBe('iso');
		expect(dateShape('2026-01-02T03:04:05.000Z')).toBe('iso-offset');
		expect(dateShape('2026-01-02')).toBe('date-only');
		expect(dateVariants('2026-01-02 03:04:05')).toEqual({
			space: '2026-01-02 03:04:05',
			iso: '2026-01-02T03:04:05',
		});
	});

	it('builds the four array encodings', () => {
		const e = arrayEncodings('s_code_in', ['a', 'b']);
		expect(toQueryString(e.comma)).toBe('s_code_in=a%2Cb');
		expect(toQueryString(e.repeated)).toBe('s_code_in=a&s_code_in=b');
		expect(toQueryString(e.indexed)).toBe('s_code_in%5B0%5D=a&s_code_in%5B1%5D=b');
		expect(toQueryString(e.brackets)).toBe('s_code_in%5B%5D=a&s_code_in%5B%5D=b');
	});
});
