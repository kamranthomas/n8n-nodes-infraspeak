/**
 * Pure logic for the live-API verify script: reading records, picking probe values,
 * and turning responses into verdicts. No I/O here, so test/verify.test.ts can cover it.
 */

export interface ApiRecord {
	id: string;
	type?: string;
	attributes: Record<string, unknown>;
	relationships?: Record<string, { data?: { id?: unknown } | null }>;
}

export type Verdict =
	| 'works' // the parameter narrowed results the way the node expects
	| 'ignored' // 200, but results include records that don't match
	| 'rejected' // the API answered 4xx/5xx
	| 'empty' // 200 with no results, though the probe value came from a real record
	| 'partial' // arrays only: just one of the two values was applied
	| 'inconclusive'; // the sample can't tell (attribute missing, every record already matches...)

type Scalar = string | number | boolean;

const isScalar = (v: unknown): v is Scalar =>
	typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Records from a list response: JSON:API `data`, or a bare array. Undefined if it isn't a list. */
export function recordsOf(body: unknown): ApiRecord[] | undefined {
	let list: unknown[] | undefined;
	if (Array.isArray(body)) list = body;
	else if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
		list = (body as { data: unknown[] }).data;
	}
	if (!list) return undefined;
	return list
		.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
		.map((r) => ({
			id: String(r.id ?? ''),
			type: typeof r.type === 'string' ? r.type : undefined,
			attributes:
				r.attributes && typeof r.attributes === 'object'
					? (r.attributes as Record<string, unknown>)
					: r,
			relationships: r.relationships as ApiRecord['relationships'],
		}));
}

/** A record's value for a filter's attribute: attributes first, then `x_id` → relationship `x`. */
export function valueOf(record: ApiRecord, attribute: string): unknown {
	if (attribute in record.attributes) return record.attributes[attribute];
	if (attribute === 'id') return record.id;
	const relation = attribute.endsWith('_id') ? attribute.slice(0, -3) : undefined;
	const related = relation ? record.relationships?.[relation]?.data : undefined;
	return related?.id ?? undefined;
}

/** Loose equality across the API's types: 1 == "1", true == "1" == "true", case-insensitive. */
export function sameValue(a: unknown, b: unknown): boolean {
	const norm = (v: unknown) => {
		const s = String(v).trim().toLowerCase();
		return s === '1' ? 'true' : s === '0' ? 'false' : s;
	};
	const x = String(a).trim().toLowerCase();
	const y = String(b).trim().toLowerCase();
	return x === y || norm(a) === norm(b);
}

/** The attribute a filter param targets: `s_name_like` → `name`, `date_min_start_date` → `start_date`. */
export function attributeOf(param: string): string {
	return param
		.replace(/^(date_min_|date_max_)/, '')
		.replace(/^(s_|sc_)/, '')
		.replace(/_(like|in|notin)$/, '');
}

/** The other spelling of an equality filter: bare ↔ `s_`. Undefined for names with no counterpart. */
export function alternativeName(param: string): string | undefined {
	if (param.startsWith('sc_') || param.includes('[')) return undefined;
	return param.startsWith('s_') ? param.slice(2) : `s_${param}`;
}

/**
 * A value present in the sample that not every record shares, so filtering on it is
 * observable. Falls back to a value everyone shares (the result is then inconclusive).
 */
export function pickValue(
	records: ApiRecord[],
	attribute: string,
): { value: Scalar; observable: boolean } | undefined {
	const values = records.map((r) => valueOf(r, attribute)).filter(isScalar);
	if (values.length === 0) return undefined;
	const counts = new Map<string, { value: Scalar; n: number }>();
	for (const v of values) {
		const key = String(v);
		counts.set(key, { value: v, n: (counts.get(key)?.n ?? 0) + 1 });
	}
	const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
	// The most common value that still leaves records out: likely to be found again.
	const leavesSomeOut = ranked.find((c) => c.n < records.length);
	return leavesSomeOut
		? { value: leavesSomeOut.value, observable: true }
		: { value: ranked[0].value, observable: false };
}

/** Two distinct values for an `_in` probe. */
export function pickTwoValues(
	records: ApiRecord[],
	attribute: string,
): [string, string] | undefined {
	const distinct = [
		...new Set(
			records
				.map((r) => valueOf(r, attribute))
				.filter(isScalar)
				.map(String),
		),
	];
	return distinct.length >= 2 ? [distinct[0], distinct[1]] : undefined;
}

/** A word from one record's text that not every record contains, for a "contains" search. */
export function pickSearchTerm(records: ApiRecord[], attribute: string): string | undefined {
	const texts = records
		.map((r) => valueOf(r, attribute))
		.filter((v): v is string => typeof v === 'string');
	for (const text of texts) {
		for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
			if (word.length < 3) continue;
			const term = word.toLowerCase();
			const hits = texts.filter((t) => t.toLowerCase().includes(term)).length;
			if (hits < records.length) return word;
		}
	}
	return undefined;
}

/** Verdict for an equality filter. `observable`: the sample had records that don't match. */
export function judgeEquality(
	status: number,
	results: ApiRecord[] | undefined,
	attribute: string,
	value: unknown,
	observable: boolean,
): Verdict {
	if (status >= 400) return 'rejected';
	if (!results) return 'inconclusive';
	if (results.length === 0) return 'empty';
	const present = results.filter((r) => valueOf(r, attribute) !== undefined);
	if (present.length === 0) return 'inconclusive';
	if (!present.every((r) => sameValue(valueOf(r, attribute), value))) return 'ignored';
	return observable ? 'works' : 'inconclusive';
}

/**
 * Verdict for a "contains" search. With `attribute`, that field must contain the term;
 * without (free-text search params), any string attribute may.
 */
export function judgeContains(
	status: number,
	results: ApiRecord[] | undefined,
	term: string,
	attribute?: string,
): Verdict {
	if (status >= 400) return 'rejected';
	if (!results) return 'inconclusive';
	if (results.length === 0) return 'empty';
	const t = term.toLowerCase();
	const matches = (r: ApiRecord) =>
		attribute
			? String(valueOf(r, attribute) ?? '')
					.toLowerCase()
					.includes(t)
			: Object.values(r.attributes).some(
					(v) => typeof v === 'string' && v.toLowerCase().includes(t),
				);
	if (results.every(matches)) return 'works';
	// Free-text search may match related fields we can't see, so only a field search can say "ignored".
	return attribute ? 'ignored' : 'inconclusive';
}

/** Verdict for an `_in` (or `_notin`) probe with two values. */
export function judgeIn(
	status: number,
	results: ApiRecord[] | undefined,
	attribute: string,
	values: [string, string],
	negate: boolean,
): Verdict {
	if (status >= 400) return 'rejected';
	if (!results) return 'inconclusive';
	if (results.length === 0) return negate ? 'inconclusive' : 'empty';
	const got = results.map((r) => valueOf(r, attribute));
	if (got.every((v) => v === undefined)) return 'inconclusive';
	const seen = values.filter((x) => got.some((v) => sameValue(v, x)));
	if (negate) return seen.length === 0 ? 'works' : seen.length === 1 ? 'partial' : 'ignored';
	if (!got.every((v) => values.some((x) => sameValue(v, x)))) return 'ignored';
	return seen.length === 2 ? 'works' : 'partial';
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/;

/** `YYYY-MM-DD HH:MM:SS` from whatever the API returned, ignoring any offset. Comparable as a string. */
export function normalizeDate(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const m = DATE_RE.exec(value);
	if (!m) return undefined;
	const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
	return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

export type DateShape = 'space' | 'iso' | 'iso-offset' | 'date-only' | 'other';

export function dateShape(value: string): DateShape {
	if (/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return 'space';
	if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?$/.test(value)) return 'iso';
	if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)$/.test(value)) return 'iso-offset';
	if (/^\d{4}-\d\d-\d\d$/.test(value)) return 'date-only';
	return 'other';
}

/** The median date in the sample, so a min/max filter on it should drop roughly half. */
export function pickDate(records: ApiRecord[], attribute: string): string | undefined {
	const dates = records
		.map((r) => normalizeDate(valueOf(r, attribute)))
		.filter((d): d is string => !!d)
		.sort();
	if (dates.length < 2 || dates[0] === dates[dates.length - 1]) return undefined;
	return dates[Math.floor(dates.length / 2)];
}

/** Verdict for `date_min_x` / `date_max_x` = pivot. */
export function judgeDate(
	status: number,
	results: ApiRecord[] | undefined,
	attribute: string,
	pivot: string,
	bound: 'min' | 'max',
): Verdict {
	if (status >= 400) return 'rejected';
	if (!results) return 'inconclusive';
	if (results.length === 0) return 'empty';
	const dates = results.map((r) => normalizeDate(valueOf(r, attribute)));
	// Records without the date can't satisfy a range: the filter wasn't applied.
	if (dates.some((d) => d === undefined)) return 'ignored';
	const inRange = (d: string) => (bound === 'min' ? d >= pivot : d <= pivot);
	return (dates as string[]).every(inRange) ? 'works' : 'ignored';
}

/** The pivot written the two ways the node could send it. */
export function dateVariants(pivot: string): { space: string; iso: string } {
	return { space: pivot, iso: pivot.replace(' ', 'T') };
}

// ─── Query strings ───────────────────────────────────────────────────────────

export type Query = Array<[string, string]>;

export function toQueryString(query: Query): string {
	return query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** The array encodings an API might parse. `comma` is what the node sends today. */
export function arrayEncodings(param: string, values: string[]): Record<string, Query> {
	return {
		comma: [[param, values.join(',')]],
		repeated: values.map((v): [string, string] => [param, v]),
		indexed: values.map((v, i): [string, string] => [`${param}[${i}]`, v]), // what n8n sends for a real array
		brackets: values.map((v): [string, string] => [`${param}[]`, v]),
	};
}
