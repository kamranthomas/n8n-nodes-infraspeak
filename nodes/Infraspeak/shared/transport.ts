import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

export const INFRASPEAK_BASE_URL = 'https://api.infraspeak.com/v3';

/** Base URL from the credential (for a sandbox or a local mock), else production, without a trailing slash. */
export const INFRASPEAK_BASE_URL_EXPRESSION = `={{ ($credentials.baseUrl || "${INFRASPEAK_BASE_URL}").replace(/\\/+$/, "") }}`;

function resolveBaseUrl(baseUrl: unknown): string {
	return (typeof baseUrl === 'string' && baseUrl !== '' ? baseUrl : INFRASPEAK_BASE_URL).replace(
		/\/+$/,
		'',
	);
}

export async function infraspeakApiRequest(
	this: ILoadOptionsFunctions | IExecuteSingleFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	qs: IDataObject = {},
): Promise<unknown> {
	const credentials = await this.getCredentials('infraspeakApi');
	const options: IHttpRequestOptions = {
		method,
		url: `${resolveBaseUrl(credentials.baseUrl)}${endpoint}`,
		qs,
		headers: { Accept: 'application/json' },
		json: true,
	};

	return await this.helpers.httpRequestWithAuthentication.call(this, 'infraspeakApi', options);
}
