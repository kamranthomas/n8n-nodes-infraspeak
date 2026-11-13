/* eslint-disable @n8n/community-nodes/no-restricted-globals, no-console --
 * Dev-only CLI script, never shipped (package.json `files` is only `dist`). */
/**
 * Sends a sample Infraspeak webhook delivery to an n8n Infraspeak Trigger URL, with the
 * same headers Infraspeak uses. For testing the trigger without an Infraspeak account.
 *
 *   npm run webhook:send -- <url> [--event FAILURE_CREATED] [--secret s] [--method PUT] [--bad-signature]
 */
import { randomUUID } from 'node:crypto';
import { signBody } from '../nodes/InfraspeakTrigger/signature';

function parseArgs(argv: string[]) {
	const [url, ...rest] = argv;
	const opts: Record<string, string | boolean> = {};
	for (let i = 0; i < rest.length; i++) {
		const key = rest[i].replace(/^--/, '');
		const next = rest[i + 1];
		if (next === undefined || next.startsWith('--')) opts[key] = true;
		else opts[key] = rest[++i];
	}
	return { url, opts };
}

async function main() {
	const { url, opts } = parseArgs(process.argv.slice(2));
	if (!url || !/^https?:\/\//.test(url)) {
		console.error(
			'Usage: npm run webhook:send -- <url> [--event FAILURE_CREATED] [--secret s] [--method PUT] [--bad-signature]',
		);
		process.exit(2);
	}
	const event = typeof opts.event === 'string' ? opts.event : 'FAILURE_CREATED';
	const method = typeof opts.method === 'string' ? opts.method.toUpperCase() : 'POST';
	const body = JSON.stringify({
		data: {
			type: 'failure',
			id: '12345',
			attributes: {
				failure_id: 12345,
				description: 'HVAC not cooling',
				state: 'WAITING_APPROVAL',
				priority: 2,
				local_id: 6789,
			},
		},
	});

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Request-Uuid': randomUUID(),
		'X-Is-Topic': event,
	};
	if (typeof opts.secret === 'string') {
		headers['X-Hook-Secret'] = opts['bad-signature']
			? signBody(body, `${opts.secret}-wrong`)
			: signBody(body, opts.secret);
	}

	const res = await fetch(url, { method, headers, body });
	console.log(`${method} ${url} → ${res.status}`);
	console.log(await res.text());
	process.exit(res.ok ? 0 : 1);
}

void main();
