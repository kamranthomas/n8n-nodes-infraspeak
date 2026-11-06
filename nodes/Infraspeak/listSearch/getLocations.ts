import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';
import { infraspeakApiRequest } from '../shared/transport';
import type { JsonApiResource } from '../shared/utils';

const PAGE_SIZE = 50;

interface LocationAttributes extends IDataObject {
	name: string;
	full_code?: string | null;
}

/**
 * Lists only real locations (JSON:API type `location`). Failures can't be
 * attached to buildings or location folders.
 */
export async function getLocations(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const page = paginationToken ? Number(paginationToken) : 1;
	const qs: IDataObject = { limit: PAGE_SIZE, page, is_real: true };
	if (filter) {
		qs.sc_search = filter;
	}

	const response = (await infraspeakApiRequest.call(this, 'GET', '/locations', qs)) as {
		data: Array<JsonApiResource<LocationAttributes>>;
	};
	const locations = response.data ?? [];

	return {
		results: locations
			.filter((location) => location.type === 'location')
			.map((location) => ({
				name: location.attributes.full_code
					? `${location.attributes.full_code} – ${location.attributes.name}`
					: location.attributes.name,
				value: location.id,
			})),
		// Paginate on the raw page size: the type filter above can shrink a full page.
		paginationToken: locations.length === PAGE_SIZE ? String(page + 1) : undefined,
	};
}
