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
 * locator object and an already-extracted value.
 */
export const resourceLocatorIdExpression =
	'={{ Number(typeof $value === "object" && $value !== null ? $value.value : $value) }}';

/**
 * Integer-array body value from a comma-separated string (or an array passed via
 * an expression), e.g. "1, 2, 3" → [1, 2, 3]. Blank entries are dropped.
 */
export const intArrayExpression =
	'={{ (Array.isArray($value) ? $value : String($value).split(",")).map(v => String(v).trim()).filter(v => v !== "").map(Number) }}';

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
