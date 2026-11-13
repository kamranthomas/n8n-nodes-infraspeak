import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';
import { infraspeakApiRequest } from '../shared/transport';
import type { JsonApiResource } from '../shared/utils';

const PAGE_SIZE = 50;

export interface ListSearchConfig {
	/**
	 * Endpoint to list from. A function may derive it from other node parameters;
	 * returning `undefined` yields an empty list (e.g. a dependency isn't set yet).
	 */
	endpoint: string | ((this: ILoadOptionsFunctions) => string | undefined);
	/** Query param for server-side search. Omit to filter by label client-side. */
	searchParam?: string;
	/** Extra query params sent on every request. */
	qs?: IDataObject;
	/** Only keep records of this JSON:API type. */
	type?: string;
	/** Builds the dropdown label from a record's attributes. */
	label: (attributes: IDataObject) => string;
}

/** Builds a paginated, searchable `listSearch` method for a JSON:API list endpoint. */
export function makeListSearch(config: ListSearchConfig) {
	return async function (
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		const endpoint =
			typeof config.endpoint === 'function' ? config.endpoint.call(this) : config.endpoint;
		if (!endpoint) {
			return { results: [] };
		}

		const page = paginationToken ? Number(paginationToken) : 1;
		const qs: IDataObject = { ...config.qs, limit: PAGE_SIZE, page };
		if (filter && config.searchParam) {
			qs[config.searchParam] = filter;
		}

		const response = (await infraspeakApiRequest.call(this, 'GET', endpoint, qs)) as {
			data?: JsonApiResource[];
		};
		const records = response.data ?? [];
		const needle = filter && !config.searchParam ? filter.toLowerCase() : undefined;

		const results: INodeListSearchItems[] = records
			.filter((record) => !config.type || record.type === config.type)
			.map((record) => ({ name: config.label(record.attributes ?? {}), value: record.id }))
			.filter((item) => !needle || item.name.toLowerCase().includes(needle));

		return {
			results,
			// Paginate on the raw page size: the type filter above can shrink a full page.
			paginationToken: records.length === PAGE_SIZE ? String(page + 1) : undefined,
		};
	};
}

/**
 * Reads a resourceLocator value that may live at the top level or inside one of the
 * node's collections (e.g. `updateFields.problemAreaId`).
 */
export function findLocatorValue(
	this: ILoadOptionsFunctions,
	name: string,
	collections: string[] = ['additionalFields', 'updateFields', 'filters'],
): string | undefined {
	const read = (value: unknown): string | undefined => {
		if (value && typeof value === 'object' && 'value' in value) {
			return read((value as IDataObject).value);
		}
		return value === undefined || value === null || value === '' ? undefined : String(value);
	};

	const parameters = this.getCurrentNodeParameters() ?? {};
	const topLevel = read(parameters[name]);
	if (topLevel) {
		return topLevel;
	}
	for (const collection of collections) {
		const nested = read((parameters[collection] as IDataObject | undefined)?.[name]);
		if (nested) {
			return nested;
		}
	}
	return undefined;
}
