import nock from 'nock';
import type { IDataObject, IHttpRequestOptions, ILoadOptionsFunctions } from 'n8n-workflow';
import { listSearch } from '../nodes/Infraspeak/listSearch';
import { runNode, TEST_TOKEN, useNock } from './harness';

const MOCK_URL = 'http://localhost:4010';

describe('Custom base URL (sandbox or local mock)', () => {
	useNock({ assertAllUsed: true });

	it('routes operations to the credential base URL, without a trailing slash', async () => {
		nock(MOCK_URL)
			.get('/failures/7')
			.matchHeader('authorization', `Bearer ${TEST_TOKEN}`)
			.reply(200, { data: { id: '7', type: 'failure', attributes: {} } });

		const { items, error } = await runNode(
			{ resource: 'failure', operation: 'get', failureId: '7', simplify: true },
			{ credentials: { accessToken: TEST_TOKEN, baseUrl: `${MOCK_URL}/` } },
		);

		expect(error).toBeUndefined();
		expect(items[0].json.id).toBe('7');
	});

	it('sends dropdown searches to the credential base URL', async () => {
		const urls: string[] = [];
		const context = {
			getCredentials: async () => ({ accessToken: TEST_TOKEN, baseUrl: `${MOCK_URL}/` }),
			getNodeParameter: () => undefined,
			helpers: {
				httpRequestWithAuthentication: async (_type: string, options: IHttpRequestOptions) => {
					urls.push(options.url);
					return { data: [{ id: '1', type: 'client', attributes: { name: 'Acme' } }] };
				},
			},
		} as unknown as ILoadOptionsFunctions;

		const result = await listSearch.getClients.call(context);

		expect(urls).toEqual([`${MOCK_URL}/clients`]);
		expect(result.results).toEqual([{ name: 'Acme', value: '1' }] as IDataObject[]);
	});
});
