/**
 * Runs every generated operation against a Prism mock of the spec (`npm run mock`).
 *
 * Opt-in: skipped unless INFRASPEAK_MOCK_URL is set, because it needs the mock
 * running. Use `npm run test:mock` (mock on http://127.0.0.1:4010).
 *
 * Prism answers a request that breaks the spec with a 4xx, which fails the node, so
 * a passing operation means Prism accepted its request. It's a second, independent
 * opinion on spec conformance next to test/conformance.test.ts: Prism's validator
 * instead of ajv, real HTTP instead of nock. It still only proves the node matches
 * the spec, not the live API.
 */
/* eslint-disable @n8n/community-nodes/no-restricted-globals --
 * Test-only file (never shipped): reads the mock URL from the environment. */
import { runNode, TEST_TOKEN } from './harness';
import { build, label, operations, type Operation } from './manifest';

const MOCK_URL = process.env.INFRASPEAK_MOCK_URL;
const describeIfMock = MOCK_URL ? describe : describe.skip;

describeIfMock('operations against the Prism mock', () => {
	// A required-only Update with nothing required has no request worth sending.
	const nothingToSend = (op: Operation) =>
		op.method === 'PATCH' && !op.fields.some((f) => f.required && f.target === 'body');

	it.each(
		operations.flatMap((op) =>
			(['required', 'all'] as const)
				.filter((mode) => mode === 'all' || !nothingToSend(op))
				.map((mode) => [`${label(op)} (${mode} fields)`, op, mode] as const),
		),
	)('%s', async (_, op, mode) => {
		// The node sends dates as YYYY-MM-DD HH:MM:SS (the docs); the spec says ISO 8601.
		// That's a known, tracked conflict, so optional dates are left out here.
		const { parameters } = build(op, mode, { skipOptionalDates: true });
		const { error } = await runNode(parameters, {
			credentials: { accessToken: TEST_TOKEN, baseUrl: MOCK_URL },
		});
		expect(error?.message).toBeUndefined();
	});
});
