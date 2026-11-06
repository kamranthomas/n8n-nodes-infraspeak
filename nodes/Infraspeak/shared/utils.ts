import type {
	IDataObject,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
} from 'n8n-workflow';

/** A single JSON:API resource object as returned by the Infraspeak API. */
export interface JsonApiResource<TAttributes extends IDataObject = IDataObject> {
	id: string;
	type: string;
	attributes: TAttributes;
	relationships?: IDataObject;
}

/** Top-level JSON:API document. `data` is an array for lists, an object for single records. */
export interface JsonApiDocument<TAttributes extends IDataObject = IDataObject> {
	data: Array<JsonApiResource<TAttributes>> | JsonApiResource<TAttributes>;
	included?: IDataObject[];
	meta?: IDataObject;
	links?: IDataObject;
}

/**
 * Converts a date coming from an n8n dateTime field (ISO 8601) to the
 * `YYYY-MM-DD HH:MM:SS` format the Infraspeak API expects. Used inside
 * routing expressions so no runtime dependency on Luxon is needed.
 */
export const toInfraspeakDateExpression =
	'={{ DateTime.fromISO($value).toFormat("yyyy-MM-dd HH:mm:ss") }}';

/**
 * Value of a resourceLocator parameter as an integer. Handles both the raw
 * locator object and an already-extracted value. A non-numeric value is sent
 * unchanged, so the API rejects it with the bad ID visible instead of the node
 * silently sending `null` (what JSON makes of `Number("abc")`).
 */
export const resourceLocatorIdExpression =
	'={{ (id => /^\\d+$/.test(String(id)) ? Number(id) : id)(typeof $value === "object" && $value !== null ? $value.value : $value) }}';

/**
 * Integer-array body value from a comma-separated string (or an array passed via
 * an expression), e.g. "1, 2, 3" → [1, 2, 3]. Blank entries are dropped.
 */
export const intArrayExpression =
	'={{ (Array.isArray($value) ? $value : String($value).split(",")).map(v => String(v).trim()).filter(v => v !== "").map(Number) }}';

/** String-array body value from a comma-separated string (or an array), e.g. "a, b" → ["a", "b"]. */
export const stringArrayExpression =
	'={{ (Array.isArray($value) ? $value : String($value).split(",")).map(v => String(v).trim()).filter(v => v !== "") }}';

/** Body value from a JSON field: the field holds a JSON string, or an object/array via an expression. */
export const jsonValueExpression = '={{ typeof $value === "string" ? JSON.parse($value) : $value }}';

/**
 * postReceive hook shared by every operation that returns records. Unwraps the JSON:API
 * `data` member into one n8n item per record and, when Simplify is on,
 * flattens each record to `{ id, ...attributes }`.
 */
export async function unwrapJsonApi(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const body = response.body as JsonApiDocument | undefined;
	if (!body || body.data === undefined || body.data === null) {
		return [];
	}

	const records = Array.isArray(body.data) ? body.data : [body.data];
	const simplify = this.getNodeParameter('simplify', true) as boolean;

	return records.map((record) => ({
		json: simplify ? { id: record.id, ...record.attributes } : (record as unknown as IDataObject),
	}));
}
