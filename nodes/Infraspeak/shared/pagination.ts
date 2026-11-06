import type {
	DeclarativeRestApiSettings,
	IDataObject,
	IDisplayOptions,
	IExecutePaginationFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';

/** Page size used when Return All paginates. Matches the API's default page size. */
export const RETURN_ALL_PAGE_SIZE = 200;

/**
 * Page-number pagination for Return All.
 *
 * Keeps its own page counter instead of reading `meta.pagination`: the Infraspeak
 * docs mark `total_pages` as deprecated (it returns the next page number) and say
 * to stop once a page comes back with fewer items than the page size. The
 * declarative `generic` paginator can't do this, because it has no page counter
 * (`$pageCount` only exists in the HTTP Request node's paginator).
 */
export async function paginateByPage(
	this: IExecutePaginationFunctions,
	requestData: DeclarativeRestApiSettings.ResultOptions,
): Promise<INodeExecutionData[]> {
	const results: INodeExecutionData[] = [];
	const baseQs = (requestData.options.qs ?? {}) as IDataObject;

	for (let page = 1; ; page++) {
		const items = await this.makeRoutingRequest({
			...requestData,
			options: {
				...requestData.options,
				qs: { ...baseQs, limit: RETURN_ALL_PAGE_SIZE, page },
			},
		});
		results.push(...items);
		if (items.length < RETURN_ALL_PAGE_SIZE) {
			return results;
		}
	}
}

/** Return All + Limit parameters for a list operation. */
export function returnAllAndLimitFields(show: IDisplayOptions['show']): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
			routing: {
				send: { paginate: '={{ $value }}' },
				operations: { pagination: paginateByPage },
			},
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1, maxValue: 2000 },
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
			routing: {
				request: { qs: { page: 1 } },
				send: { type: 'query', property: 'limit' },
				output: { maxResults: '={{ $value }}' },
			},
		},
	];
}
