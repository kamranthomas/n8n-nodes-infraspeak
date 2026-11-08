/* eslint-disable @n8n/community-nodes/no-restricted-imports --
 * Dev-only build script: reads the spec and writes files. Never shipped (package.json
 * `files` is only `dist`), so the Cloud rules for node runtime code don't apply. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { SPEC_PATH, SPEC_URL } from './overrides';

/** JSON Schema subset used by the Infraspeak spec (no $refs, OpenAPI 3.1-style nullable types). */
export interface Schema {
	type?: string | string[];
	format?: string;
	enum?: Array<string | number>;
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	description?: string;
	readOnly?: boolean;
	oneOf?: Schema[];
	[key: string]: unknown;
}

export interface Param {
	name: string;
	in: 'path' | 'query';
	required: boolean;
	schema: Schema;
	description?: string;
	deprecated?: boolean;
}

export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface SpecOperation {
	operationId: string;
	tag: string;
	method: HttpMethod;
	path: string;
	summary: string;
	description: string;
	deprecated: boolean;
	pathParams: Param[];
	queryParams: Param[];
	/** JSON request body schema, if any. */
	body?: Schema;
	/** What a 200 response's `data` holds. */
	returns: 'record' | 'records' | 'other';
}

export interface LoadedSpec {
	operations: SpecOperation[];
	sha256: string;
}

const METHODS: HttpMethod[] = ['get', 'post', 'patch', 'put', 'delete'];

/** Primary (non-null) type of a schema, e.g. ['string', 'null'] → 'string'. */
export function primaryType(schema: Schema): string | undefined {
	if (Array.isArray(schema.type)) {
		return schema.type.find((t) => t !== 'null');
	}
	if (schema.type) {
		return schema.type;
	}
	if (schema.oneOf?.every((s) => primaryType(s) === 'string')) {
		return 'string';
	}
	return undefined;
}

function classifyResponse(op: Record<string, unknown>): SpecOperation['returns'] {
	const responses = (op.responses ?? {}) as Record<
		string,
		{ content?: Record<string, { schema?: Schema }> }
	>;
	const ok = responses['200'] ?? responses['201'];
	const data = ok?.content?.['application/json']?.schema?.properties?.data;
	if (!data) return 'other';
	// Polymorphic resources (e.g. a location is a building, folder or location) are a
	// oneOf/anyOf of JSON:API records: it's a record if every variant is one.
	const isRecord = (schema: Schema | undefined): boolean => {
		if (!schema) return false;
		if (schema.properties?.attributes) return true;
		const variants = schema.oneOf ?? (schema.anyOf as Schema[] | undefined);
		return Boolean(variants?.length && variants.every((variant) => isRecord(variant)));
	};
	if (primaryType(data) === 'array') {
		return isRecord(data.items) ? 'records' : 'other';
	}
	return isRecord(data) ? 'record' : 'other';
}

export function loadSpec(): LoadedSpec {
	if (!existsSync(SPEC_PATH)) {
		throw new Error(
			`Spec not found at ${SPEC_PATH}. Download it first:\n  curl -o ${SPEC_PATH} ${SPEC_URL}`,
		);
	}
	const raw = readFileSync(SPEC_PATH, 'utf8');
	const spec = parse(raw) as { paths: Record<string, Record<string, Record<string, unknown>>> };

	const operations: SpecOperation[] = [];
	for (const [path, item] of Object.entries(spec.paths)) {
		for (const method of METHODS) {
			const op = item[method];
			if (!op) continue;
			const params = ((op.parameters ?? []) as Param[]).filter(
				(p) => p.in === 'path' || p.in === 'query',
			);
			const content = (
				op.requestBody as { content?: Record<string, { schema?: Schema }> } | undefined
			)?.content;
			operations.push({
				operationId: String(op.operationId),
				tag: ((op.tags as string[] | undefined) ?? ['?'])[0],
				method,
				path,
				summary: String(op.summary ?? ''),
				description: String(op.description ?? ''),
				deprecated: op.deprecated === true,
				pathParams: params.filter((p) => p.in === 'path'),
				queryParams: params.filter((p) => p.in === 'query'),
				body: content?.['application/json']?.schema,
				returns: classifyResponse(op),
			});
		}
	}

	return { operations, sha256: createHash('sha256').update(raw).digest('hex') };
}
