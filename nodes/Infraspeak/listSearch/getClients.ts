import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';
import { infraspeakApiRequest } from '../shared/transport';
import type { JsonApiResource } from '../shared/utils';

const PAGE_SIZE = 50;

interface ClientAttributes extends IDataObject {
	name: string;
	code?: string | null;
}

export async function getClients(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const page = paginationToken ? Number(paginationToken) : 1;
	const qs: IDataObject = { limit: PAGE_SIZE, page, sort: 'name' };
	if (filter) {
		qs.s_name_like = filter;
	}

	const response = (await infraspeakApiRequest.call(this, 'GET', '/clients', qs)) as {
		data: Array<JsonApiResource<ClientAttributes>>;
	};
	const clients = response.data ?? [];

	return {
		results: clients.map((client) => ({
			name: client.attributes.code
				? `${client.attributes.name} (${client.attributes.code})`
				: client.attributes.name,
			value: client.id,
		})),
		paginationToken: clients.length === PAGE_SIZE ? String(page + 1) : undefined,
	};
}
