/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals, no-console --
 * Dev-only CLI script, never shipped (package.json `files` is only `dist`). */
/**
 * Read-only check of the node's API assumptions against a live Infraspeak account.
 * Sends GET requests only and never prints the token.
 *
 *   INFRASPEAK_TOKEN=... npm run verify [-- --only lists,gets,filters,searches,arrays,dates,isReal]
 *
 * Optional env: INFRASPEAK_BASE_URL (default production), INFRASPEAK_VERIFY_DELAY_MS
 * (default 1100: the API allows 60 requests a minute).
 *
 * Writes verify-report.json (gitignored: it holds probe values from the account).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation } from '../../test/manifest';
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
	pickDate,
	pickSearchTerm,
	pickTwoValues,
	pickValue,
	recordsOf,
	toQueryString,
	valueOf,
	type ApiRecord,
	type Query,
	type Verdict,
} from './checks';

const ROOT = join(__dirname, '..', '..');
const TOKEN = process.env.INFRASPEAK_TOKEN ?? '';
const BASE = (process.env.INFRASPEAK_BASE_URL || 'https://api.infraspeak.com/v3').replace(
	/\/+$/,
	'',
);
const DELAY = Number(process.env.INFRASPEAK_VERIFY_DELAY_MS ?? 1100);
const SAMPLE_SIZE = 50;

const SECTIONS = [
	'lists',
	'pagination',
	'gets',
	'filters',
	'searches',
	'arrays',
	'dates',
	'isReal',
] as const;
type Section = (typeof SECTIONS)[number];

/** Path prefixes with no list of their own, mapped to a list whose IDs fit. */
const PARENT_HINTS: Record<string, string> = {
	'/stocks/material-types/ancestor-folders': '/stocks/material-types',
};

/** Dropdown searches from nodes/Infraspeak/listSearch/index.ts. */
const DROPDOWN_SEARCHES = [
	{ path: '/clients', param: 's_name_like', attribute: 'name', field: true },
	{ path: '/locations', param: 'sc_search', attribute: 'name', field: false },
	{ path: '/categories/all', param: 'sc_search', attribute: 'name', field: false },
	{ path: '/stocks/warehouses', param: 'searchText', attribute: 'name', field: false },
];

const NOT_FILTERS = new Set([
	'sort',
	'expanded',
	'limit',
	'page',
	'sc_search',
	'searchText',
	'search',
]);

// ─── HTTP (GET only) ─────────────────────────────────────────────────────────

interface Reply {
	status: number;
	body: unknown;
	records?: ApiRecord[];
}

let requestCount = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string, query: Query = []): Promise<Reply> {
	const qs = toQueryString(query);
	const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
	for (let attempt = 0; ; attempt++) {
		if (requestCount++ > 0) await sleep(DELAY);
		let res: Response;
		try {
			res = await fetch(url, {
				method: 'GET',
				headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` },
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			return { status: 0, body: { error: (error as Error).message } };
		}
		if (res.status === 429 && attempt < 3) {
			const wait = Number(res.headers.get('retry-after') ?? 60);
			console.log(`  … rate limited, waiting ${wait}s`);
			await sleep(wait * 1000);
			continue;
		}
		const text = await res.text();
		let body: unknown = text;
		try {
			body = JSON.parse(text);
		} catch {
			// not JSON: keep the text
		}
		return { status: res.status, body, records: res.ok ? recordsOf(body) : undefined };
	}
}

// ─── Report ──────────────────────────────────────────────────────────────────

interface Probe {
	section: Section;
	path: string;
	param?: string;
	variant?: string;
	value?: unknown;
	status?: number;
	count?: number;
	verdict: Verdict | 'ok' | 'fail' | 'skipped';
	note?: string;
}

const probes: Probe[] = [];
const ICON: Record<Probe['verdict'], string> = {
	works: '✓',
	ok: '✓',
	ignored: '✗',
	rejected: '✗',
	fail: '✗',
	empty: '∅',
	partial: '½',
	inconclusive: '?',
	skipped: '-',
};

function record(probe: Probe) {
	probes.push(probe);
	const label = [probe.path, probe.param, probe.variant && `[${probe.variant}]`]
		.filter(Boolean)
		.join(' ');
	const detail = [
		probe.status !== undefined && `${probe.status}`,
		probe.count !== undefined && `${probe.count} rec`,
		probe.note,
	]
		.filter(Boolean)
		.join(', ');
	console.log(
		`  ${ICON[probe.verdict]} ${probe.verdict.padEnd(12)} ${label}${detail ? `  (${detail})` : ''}`,
	);
}

const heading = (title: string) =>
	console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);

// ─── Samples ─────────────────────────────────────────────────────────────────

const operations = (
	JSON.parse(readFileSync(join(ROOT, 'test/generated/manifest.json'), 'utf8')) as {
		operations: Operation[];
	}
).operations.filter((op) => op.method === 'GET');

const listTemplates = new Set(operations.filter((op) => op.list).map((op) => op.path));
const samples = new Map<string, ApiRecord[]>();

async function sampleOf(concretePath: string): Promise<ApiRecord[] | undefined> {
	if (samples.has(concretePath)) return samples.get(concretePath);
	const reply = await get(concretePath, [
		['limit', String(SAMPLE_SIZE)],
		['page', '1'],
	]);
	if (reply.status !== 200 || !reply.records) return undefined;
	samples.set(concretePath, reply.records);
	return reply.records;
}

/** Fill `{param}`s from the parent list's first record. Undefined if a parent can't be found. */
async function resolvePath(template: string): Promise<string | undefined> {
	let concrete = template;
	for (let m = /\{[^}]+\}/.exec(concrete); m; m = /\{[^}]+\}/.exec(concrete)) {
		const prefix = concrete.slice(0, m.index).replace(/\/$/, '');
		const templatePrefix = template.slice(0, template.indexOf(m[0])).replace(/\/$/, '');
		const parent = PARENT_HINTS[templatePrefix] ?? prefix;
		const isList =
			listTemplates.has(PARENT_HINTS[templatePrefix] ?? templatePrefix) || samples.has(parent);
		if (!isList) return undefined;
		const records = await sampleOf(parent);
		const id = records?.[0]?.id;
		if (!id) return undefined;
		concrete = concrete.replace(m[0], encodeURIComponent(id));
	}
	return concrete;
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkAuth() {
	heading('Auth');
	const reply = await get('/locations', [['limit', '1']]);
	if (reply.status === 401 || reply.status === 403) {
		console.error(`  ✗ ${reply.status}: the token was refused. Check INFRASPEAK_TOKEN.`);
		process.exit(2);
	}
	if (reply.status !== 200) {
		console.error(
			`  ✗ GET /locations answered ${reply.status}. Check INFRASPEAK_BASE_URL (${BASE}).`,
		);
		process.exit(2);
	}
	console.log(`  ✓ token accepted by ${BASE}`);
}

async function checkLists() {
	heading('Lists (limit=50)');
	const paths = [
		...new Set(operations.filter((op) => op.list && !op.path.includes('{')).map((op) => op.path)),
	];
	for (const path of paths) {
		const reply = await get(path, [
			['limit', String(SAMPLE_SIZE)],
			['page', '1'],
		]);
		const ok = reply.status === 200 && !!reply.records && reply.records.length <= SAMPLE_SIZE;
		if (ok) samples.set(path, reply.records!);
		record({
			section: 'lists',
			path,
			status: reply.status,
			count: reply.records?.length,
			verdict: ok ? 'ok' : 'fail',
			note: ok ? undefined : reply.records ? 'more records than limit' : 'no data array',
		});
	}
}

async function checkPagination() {
	heading('Pagination (limit=2, page=2)');
	const entry = [...samples.entries()].find(([, recs]) => recs.length >= 4);
	if (!entry) {
		record({
			section: 'pagination',
			path: '-',
			verdict: 'skipped',
			note: 'no list with 4+ records',
		});
		return;
	}
	const [path, recs] = entry;
	const reply = await get(path, [
		['limit', '2'],
		['page', '2'],
	]);
	const ids = (reply.records ?? []).map((r) => r.id);
	const expected = recs.slice(2, 4).map((r) => r.id);
	const firstPage = recs.slice(0, 2).map((r) => r.id);
	let verdict: Probe['verdict'] = 'fail';
	let note = `got ${ids.join(',')}, expected ${expected.join(',')}`;
	if (reply.status === 200 && ids.join() === expected.join()) {
		verdict = 'ok';
		note = 'page 2 = records 3–4 of page 1 at limit 50';
	} else if (reply.status === 200 && ids.length > 0 && !ids.some((id) => firstPage.includes(id))) {
		verdict = 'ok';
		note = "pages differ, but order isn't stable across limits";
	}
	record({ section: 'pagination', path, status: reply.status, count: ids.length, verdict, note });
}

async function checkGets() {
	heading('Gets and nested lists');
	const templates = [
		...new Set(operations.filter((op) => op.path.includes('{')).map((op) => op.path)),
	];
	for (const template of templates) {
		const path = await resolvePath(template);
		if (!path) {
			record({
				section: 'gets',
				path: template,
				verdict: 'skipped',
				note: 'no parent record to take an ID from',
			});
			continue;
		}
		const reply = await get(path);
		const body = reply.body as { data?: unknown } | undefined;
		// Only record-returning operations must have `data`; others (e.g. check-associations) just need a 200.
		const returnsRecords = operations.some((op) => op.path === template && op.output === 'records');
		const ok =
			reply.status === 200 &&
			(!returnsRecords || (body !== undefined && (body.data !== undefined || Array.isArray(body))));
		if (ok && reply.records && listTemplates.has(template)) samples.set(path, reply.records);
		record({ section: 'gets', path: template, status: reply.status, verdict: ok ? 'ok' : 'fail' });
	}
}

/** Sample for an operation: its own list response, resolving path params first. */
async function sampleForOperation(
	op: Operation,
): Promise<{ path: string; records: ApiRecord[] } | undefined> {
	const path = op.path.includes('{') ? await resolvePath(op.path) : op.path;
	if (!path) return undefined;
	const records = await sampleOf(path);
	return records && records.length > 0 ? { path, records } : undefined;
}

function* listFields(predicate: (property: string, field: Operation['fields'][number]) => boolean) {
	const seen = new Set<string>();
	for (const op of operations.filter((o) => o.list)) {
		for (const field of op.fields) {
			const property = field.property;
			if (field.target !== 'query' || !property) continue;
			const key = `${op.path} ${property}`;
			if (seen.has(key) || !predicate(property, field)) continue;
			seen.add(key);
			yield { op, field, property };
		}
	}
}

async function checkFilters() {
	heading('Equality filters (node name vs alternative)');
	const candidates = listFields(
		(p, f) =>
			['string', 'number', 'options', 'locator', 'boolean'].includes(f.kind) &&
			!NOT_FILTERS.has(p) &&
			!p.startsWith('date_') &&
			!p.endsWith('_like') &&
			!f.arrayItems,
	);
	for (const { op, property } of candidates) {
		const sample = await sampleForOperation(op);
		const attribute = attributeOf(property);
		const pick = sample && pickValue(sample.records, attribute);
		if (!sample || !pick) {
			record({
				section: 'filters',
				path: op.path,
				param: property,
				verdict: 'skipped',
				note: sample ? `no "${attribute}" in records` : 'no records',
			});
			continue;
		}
		const names = [property, alternativeName(property)].filter((n): n is string => !!n);
		for (const [i, name] of names.entries()) {
			const reply = await get(sample.path, [
				[name, String(pick.value)],
				['limit', String(SAMPLE_SIZE)],
			]);
			record({
				section: 'filters',
				path: op.path,
				param: name,
				variant: i === 0 ? 'node' : 'alternative',
				value: pick.value,
				status: reply.status,
				count: reply.records?.length,
				verdict: judgeEquality(reply.status, reply.records, attribute, pick.value, pick.observable),
			});
		}
	}
}

async function checkSearches() {
	heading('Searches (dropdowns and "Contains" filters)');
	const targets = [
		...DROPDOWN_SEARCHES,
		...[...listFields((p) => p.endsWith('_like'))].map(({ op, property }) => ({
			path: op.path,
			param: property,
			attribute: attributeOf(property),
			field: true,
		})),
	];
	const done = new Set<string>();
	for (const t of targets) {
		if (done.has(`${t.path} ${t.param}`)) continue;
		done.add(`${t.path} ${t.param}`);
		const path = t.path.includes('{') ? await resolvePath(t.path) : t.path;
		const records = path ? await sampleOf(path) : undefined;
		const term = records && pickSearchTerm(records, t.attribute);
		if (!path || !term) {
			record({
				section: 'searches',
				path: t.path,
				param: t.param,
				verdict: 'skipped',
				note: `no usable "${t.attribute}" text`,
			});
			continue;
		}
		const reply = await get(path, [
			[t.param, term],
			['limit', String(SAMPLE_SIZE)],
		]);
		record({
			section: 'searches',
			path: t.path,
			param: t.param,
			value: term,
			status: reply.status,
			count: reply.records?.length,
			verdict: judgeContains(reply.status, reply.records, term, t.field ? t.attribute : undefined),
		});
	}
}

async function checkArrays() {
	heading('Multi-value filters (array encodings)');
	for (const { op, property } of listFields((_p, f) => !!f.arrayItems)) {
		const sample = await sampleForOperation(op);
		const attribute = attributeOf(property);
		const values = sample && pickTwoValues(sample.records, attribute);
		if (!sample || !values) {
			record({
				section: 'arrays',
				path: op.path,
				param: property,
				verdict: 'skipped',
				note: `needs 2 distinct "${attribute}" values`,
			});
			continue;
		}
		for (const [encoding, query] of Object.entries(arrayEncodings(property, values))) {
			const reply = await get(sample.path, [...query, ['limit', String(SAMPLE_SIZE)]]);
			record({
				section: 'arrays',
				path: op.path,
				param: property,
				variant: encoding,
				value: values,
				status: reply.status,
				count: reply.records?.length,
				verdict: judgeIn(
					reply.status,
					reply.records,
					attribute,
					values,
					property.endsWith('_notin'),
				),
			});
		}
	}
}

const responseDateShapes = new Map<string, number>();

async function checkDates() {
	heading('Date filters (space vs ISO)');
	for (const recs of samples.values()) {
		for (const r of recs) {
			for (const v of Object.values(r.attributes)) {
				if (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v)) {
					const shape = dateShape(v);
					responseDateShapes.set(shape, (responseDateShapes.get(shape) ?? 0) + 1);
				}
			}
		}
	}
	for (const { op, property } of listFields(
		(p) => p.startsWith('date_min_') || p.startsWith('date_max_'),
	)) {
		const sample = await sampleForOperation(op);
		const attribute = attributeOf(property);
		const pivot = sample && pickDate(sample.records, attribute);
		if (!sample || !pivot) {
			record({
				section: 'dates',
				path: op.path,
				param: property,
				verdict: 'skipped',
				note: `needs 2+ distinct "${attribute}" dates`,
			});
			continue;
		}
		const bound = property.startsWith('date_min_') ? 'min' : 'max';
		for (const [format, value] of Object.entries(dateVariants(pivot))) {
			const reply = await get(sample.path, [
				[property, value],
				['limit', String(SAMPLE_SIZE)],
			]);
			record({
				section: 'dates',
				path: op.path,
				param: property,
				variant: format,
				value,
				status: reply.status,
				count: reply.records?.length,
				verdict: judgeDate(reply.status, reply.records, attribute, pivot, bound),
			});
		}
	}
	console.log(
		`  Dates in responses: ${[...responseDateShapes.entries()].map(([s, n]) => `${s} ${n}`).join(', ') || 'none seen'}`,
	);
}

async function checkIsReal() {
	heading('is_real on /locations');
	const typesOf = (recs: ApiRecord[] | undefined) =>
		[...new Set((recs ?? []).map((r) => String(r.type ?? valueOf(r, 'type') ?? '?')))]
			.sort()
			.join(',');
	const all = await sampleOf('/locations');
	console.log(`  unfiltered types: ${typesOf(all) || 'none'}`);
	for (const value of ['true', '1']) {
		const reply = await get('/locations', [
			['is_real', value],
			['limit', String(SAMPLE_SIZE)],
		]);
		const types = typesOf(reply.records);
		const onlyLocations = types === 'location';
		const allWereLocations = typesOf(all) === 'location';
		record({
			section: 'isReal',
			path: '/locations',
			param: 'is_real',
			variant: value,
			status: reply.status,
			count: reply.records?.length,
			verdict:
				reply.status >= 400
					? 'rejected'
					: onlyLocations
						? allWereLocations
							? 'inconclusive'
							: 'works'
						: 'ignored',
			note: `types: ${types || 'none'}`,
		});
	}
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function count(section: Section, where: (p: Probe) => boolean) {
	return probes.filter((p) => p.section === section && where(p)).length;
}

function summarize(): boolean {
	heading('Decisions');
	let failed = false;

	const broken = probes.filter(
		(p) => (p.section === 'lists' || p.section === 'gets') && p.verdict === 'fail',
	);
	console.log(
		`• Lists and gets: ${broken.length === 0 ? 'all answered 200' : `${broken.length} failed: ${broken.map((p) => p.path).join(', ')}`}`,
	);
	if (broken.length) failed = true;

	const pages = probes.find((p) => p.section === 'pagination');
	if (pages) console.log(`• Pagination: ${pages.verdict}${pages.note ? ` (${pages.note})` : ''}`);

	const filterPairs = new Map<string, { node?: Probe; alt?: Probe }>();
	for (const p of probes.filter((x) => x.section === 'filters' && x.variant)) {
		const key = `${p.path} ${p.variant === 'node' ? p.param : alternativeName(p.param ?? '')}`;
		const pair = filterPairs.get(key) ?? {};
		pair[p.variant === 'node' ? 'node' : 'alt'] = p;
		filterPairs.set(key, pair);
	}
	const pairs = [...filterPairs.values()];
	const bare = pairs.filter((x) => x.node && !x.node.param?.startsWith('s_'));
	const bareWorks = bare.filter((x) => x.node?.verdict === 'works').length;
	const prefixedWorks = bare.filter((x) => x.alt?.verdict === 'works').length;
	const decided = bare.filter(
		(x) => x.node?.verdict === 'works' || x.alt?.verdict === 'works',
	).length;
	console.log(
		`• filterPrefix (apiRules, now ''): bare worked ${bareWorks}/${decided}, s_ worked ${prefixedWorks}/${decided} of conclusive filters` +
			(decided === 0
				? ' → no conclusive probes'
				: prefixedWorks > bareWorks
					? " → switch to 's_'"
					: " → keep ''"),
	);
	const wrongName = pairs.filter((x) => x.node?.verdict !== 'works' && x.alt?.verdict === 'works');
	if (wrongName.length) {
		failed = true;
		console.log(`  Filters that only work under the other name (fix in overrides):`);
		for (const x of wrongName)
			console.log(`    ${x.node?.path} ${x.node?.param} → use ${x.alt?.param}`);
	}

	for (const format of ['space', 'iso']) {
		console.log(
			`• Dates sent as ${format}: works ${count('dates', (p) => p.variant === format && p.verdict === 'works')}, ` +
				`rejected ${count('dates', (p) => p.variant === format && p.verdict === 'rejected')}, ` +
				`ignored ${count('dates', (p) => p.variant === format && p.verdict === 'ignored')}`,
		);
	}
	console.log(
		`  (node sends space; switch toInfraspeakDateExpression in shared/utils.ts if ISO wins)`,
	);

	const encodings = ['comma', 'repeated', 'indexed', 'brackets'];
	console.log(
		`• Multi-value encodings that work: ${encodings.map((e) => `${e} ${count('arrays', (p) => p.variant === e && p.verdict === 'works')}`).join(', ')}` +
			` (node sends comma)`,
	);

	const searches = probes.filter(
		(p) =>
			p.section === 'searches' &&
			DROPDOWN_SEARCHES.some((d) => d.path === p.path && d.param === p.param),
	);
	console.log(
		`• Dropdown searches: ${searches.map((p) => `${p.path} ${p.param} ${p.verdict}`).join('; ') || 'not run'}`,
	);
	const real = probes.filter((p) => p.section === 'isReal');
	console.log(
		`• is_real: ${real.map((p) => `=${p.variant} ${p.verdict}`).join(', ') || 'not run'}`,
	);

	console.log(
		'• Not checked (would need writes): fields required on Update, ISO body dates (buy order line estimated_at),' +
			' Create/Update/Delete payloads, and the trigger signature encoding (see Infraspeak webhook logs).',
	);
	console.log(`\n${requestCount} requests. Full results in verify-report.json.`);
	return failed;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
	if (!TOKEN) {
		console.error('Set INFRASPEAK_TOKEN to a Personal Access Token. Only GET requests are sent.');
		process.exit(2);
	}
	const onlyArg = process.argv.indexOf('--only');
	const only = new Set<string>(
		onlyArg > -1 ? (process.argv[onlyArg + 1] ?? '').split(',') : SECTIONS,
	);
	const run = (s: Section) => only.has(s);

	console.log(`Verifying against ${BASE} (GET only, ${DELAY} ms between requests)`);
	await checkAuth();
	await checkLists(); // samples feed every other section
	if (run('pagination')) await checkPagination();
	if (run('gets')) await checkGets();
	if (run('filters')) await checkFilters();
	if (run('searches')) await checkSearches();
	if (run('arrays')) await checkArrays();
	if (run('dates')) await checkDates();
	if (run('isReal')) await checkIsReal();

	const failed = summarize();
	writeFileSync(
		join(ROOT, 'verify-report.json'),
		JSON.stringify(
			{
				baseUrl: BASE,
				ranAt: new Date().toISOString(),
				requests: requestCount,
				responseDateShapes: Object.fromEntries(responseDateShapes),
				probes,
			},
			null,
			2,
		),
	);
	process.exit(failed ? 1 : 0);
}

void main();
