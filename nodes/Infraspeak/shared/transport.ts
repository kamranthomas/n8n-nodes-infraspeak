import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

export const INFRASPEAK_BASE_URL = 'https://api.infraspeak.com/v3';

export async function infraspeakApiRequest(
	this: ILoadOptionsFunctions | IExecuteSingleFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	qs: IDataObject = {},
): Promise<unknown> {
	const options: IHttpRequestOptions = {
		method,
		url: `${INFRASPEAK_BASE_URL}${endpoint}`,
		qs,
		headers: { Accept: 'application/json' },
		json: true,
	};

	return await this.helpers.httpRequestWithAuthentication.call(this, 'infraspeakApi', options);
}
