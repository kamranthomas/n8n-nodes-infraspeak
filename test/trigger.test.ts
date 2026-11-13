import { createHmac } from 'node:crypto';
import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';
import { InfraspeakTrigger } from '../nodes/InfraspeakTrigger/InfraspeakTrigger.node';
import { eventLabel, eventOptions, INFRASPEAK_EVENTS } from '../nodes/InfraspeakTrigger/events';
import { isValidSignature, signBody } from '../nodes/InfraspeakTrigger/signature';

const SECRET = 'abcdef123';
const payload = {
	data: {
		type: 'failure',
		id: '12345',
		attributes: { failure_id: 12345, description: 'HVAC not cooling', state: 'WAITING_APPROVAL' },
	},
};
const raw = Buffer.from(JSON.stringify(payload));

interface Call {
	headers?: Record<string, string>;
	params?: IDataObject;
	secret?: string;
	rawBody?: Buffer;
}

function run({ headers = {}, params = {}, secret, rawBody = raw }: Call) {
	const response = { statusCode: 200, sent: undefined as unknown };
	const res = {
		status(code: number) {
			response.statusCode = code;
			return res;
		},
		json(body: unknown) {
			response.sent = body;
			return res;
		},
	};
	const ctx = {
		getHeaderData: () => ({
			'x-is-topic': 'FAILURE_CREATED',
			'x-request-uuid': 'uuid-1',
			...headers,
		}),
		getBodyData: () => JSON.parse(rawBody.toString()) as IDataObject,
		getRequestObject: () => ({ rawBody }),
		getResponseObject: () => res,
		getNode: () => ({
			credentials: secret ? { infraspeakWebhookApi: { id: '1', name: 'x' } } : undefined,
		}),
		getCredentials: async () => ({ secret }),
		getNodeParameter: (name: string, fallback: unknown) => params[name] ?? fallback,
		helpers: { returnJsonArray: (json: IDataObject) => [{ json }] },
	} as unknown as IWebhookFunctions;
	return new InfraspeakTrigger().webhook.call(ctx).then((result) => ({ result, response }));
}

const hmac = (encoding: 'hex' | 'base64') =>
	createHmac('sha256', SECRET).update(raw).digest(encoding);

describe('Infraspeak Trigger', () => {
	it('outputs the simplified record with event and delivery ID when no secret is set', async () => {
		const { result } = await run({});
		expect(result.workflowData?.[0]).toEqual([
			{
				json: {
					id: '12345',
					type: 'failure',
					failure_id: 12345,
					description: 'HVAC not cooling',
					state: 'WAITING_APPROVAL',
					event: 'FAILURE_CREATED',
					deliveryId: 'uuid-1',
				},
			},
		]);
	});

	it('returns raw headers and body with Simplify off', async () => {
		const { result } = await run({ params: { simplify: false } });
		const json = result.workflowData?.[0][0].json as IDataObject;
		expect(json.body).toEqual(payload);
		expect(json.event).toBe('FAILURE_CREATED');
		expect((json.headers as IDataObject)['x-request-uuid']).toBe('uuid-1');
	});

	it.each([
		['hex', hmac('hex')],
		['uppercase hex', hmac('hex').toUpperCase()],
		['base64', hmac('base64')],
	])('accepts a valid %s signature', async (_label, signature) => {
		const { result } = await run({ secret: SECRET, headers: { 'x-hook-secret': signature } });
		expect(result.workflowData).toHaveLength(1);
	});

	it.each([
		[
			'a wrong signature',
			{ 'x-hook-secret': createHmac('sha256', 'other').update(raw).digest('hex') },
		],
		['no signature', {}],
		['the secret itself', { 'x-hook-secret': SECRET }],
	])('rejects %s with 401 and no run', async (_label, headers) => {
		const { result, response } = await run({ secret: SECRET, headers });
		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a body changed after signing', async () => {
		const { response } = await run({
			secret: SECRET,
			headers: { 'x-hook-secret': hmac('hex') },
			rawBody: Buffer.from(JSON.stringify({ ...payload, extra: 1 })),
		});
		expect(response.statusCode).toBe(401);
	});

	it('answers without running for an event that is not selected', async () => {
		const { result, response } = await run({ params: { events: ['FAILURE_CLOSED'] } });
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toEqual({ message: 'Event ignored' });
		expect(response.statusCode).toBe(200);
	});

	it('runs for a selected event', async () => {
		const { result } = await run({ params: { events: ['FAILURE_CLOSED', 'FAILURE_CREATED'] } });
		expect(result.workflowData).toHaveLength(1);
	});

	it('checks the signature before the event filter', async () => {
		const { response } = await run({ secret: SECRET, params: { events: ['FAILURE_CLOSED'] } });
		expect(response.statusCode).toBe(401);
	});

	it('listens for both POST and PUT on the same path', () => {
		const hooks = new InfraspeakTrigger().description.webhooks ?? [];
		expect(hooks.map((h) => h.httpMethod).sort()).toEqual(['POST', 'PUT']);
		expect(new Set(hooks.map((h) => h.path))).toEqual(new Set(['webhook']));
	});

	it('validates secret length in the credential test', async () => {
		const test = new InfraspeakTrigger().methods.credentialTest.checkWebhookSecret;
		const check = async (secret: string) =>
			(
				await test.call({} as never, {
					id: '1',
					name: 'x',
					type: 'infraspeakWebhookApi',
					data: { secret },
				})
			).status;
		expect(await check('12345')).toBe('Error');
		expect(await check('123456')).toBe('OK');
		expect(await check('x'.repeat(256))).toBe('Error');
	});
});

describe('signature', () => {
	it('round-trips with signBody', () => {
		expect(isValidSignature(raw, SECRET, signBody(raw, SECRET))).toBe(true);
	});

	it('rejects an empty secret or non-string header', () => {
		expect(isValidSignature(raw, '', signBody(raw, ''))).toBe(false);
		expect(isValidSignature(raw, SECRET, undefined)).toBe(false);
		expect(isValidSignature(raw, SECRET, ['x'])).toBe(false);
	});
});

describe('events', () => {
	it('has the 47 documented events, unique', () => {
		expect(INFRASPEAK_EVENTS).toHaveLength(47);
		expect(new Set(INFRASPEAK_EVENTS).size).toBe(47);
	});

	it('offers them sorted by label', () => {
		const names = eventOptions.map((o) => o.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		expect(eventLabel('FAILURE_STATE_CHANGED')).toBe('Failure State Changed');
	});
});
