import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Infraspeak signs each delivery with HMAC-SHA256 of the raw body, keyed with the
 * webhook's secret, in the X-Hook-Secret header. The docs don't say whether the digest
 * is hex or base64, so both are accepted until a real delivery settles it.
 */
export function isValidSignature(
	rawBody: Buffer | string,
	secret: string,
	header: unknown,
): boolean {
	if (typeof header !== 'string' || header.trim() === '' || secret === '') return false;
	const received = header.trim();
	const digest = createHmac('sha256', secret).update(rawBody).digest();

	const candidates: Buffer[] = [];
	if (/^[0-9a-f]{64}$/i.test(received)) candidates.push(Buffer.from(received, 'hex'));
	if (/^[A-Za-z0-9+/]{43}=?$/.test(received)) candidates.push(Buffer.from(received, 'base64'));

	return candidates.some((c) => c.length === digest.length && timingSafeEqual(c, digest));
}

/** The header as Infraspeak would send it, for tests and scripts/send-webhook.ts. */
export function signBody(rawBody: Buffer | string, secret: string): string {
	return createHmac('sha256', secret).update(rawBody).digest('hex');
}
