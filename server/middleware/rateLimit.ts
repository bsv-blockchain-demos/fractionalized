import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { getClientIpHeader } from '../config';

/** Requests per client per minute. In-memory counters: correct because the API runs as one instance. */
export const LIMITS = { api: 120, login: 10, value: 10 };

/** Routes that build or broadcast transactions or write ownership records. */
export const VALUE_ROUTES = [
  '/api/tokenize/create-property',
  '/api/share-purchase',
  '/api/listing-purchase',
  '/api/new-listing',
  '/api/cancel-listing', // also matches /cancel-listing/reserve
];

const PROBES = new Set(['/api/health', '/api/ready']);

// Behind a proxy (the Cloudflare tunnel) every request comes from the proxy, so the client IP is
// read from the header it sets. Opt-in: where clients can reach the app directly, they could set
// the header themselves.
function clientKey(req: Request): string {
  const header = getClientIpHeader();
  const forwarded = header ? req.get(header) : undefined;
  return ipKeyGenerator(forwarded || req.ip || '');
}

function limiter(limit: number): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: clientKey,
    skip: (req) => PROBES.has(req.originalUrl.split('?')[0]),
    message: { error: 'Too many requests, try again shortly' },
  });
}

/** Fresh limiters (and counters) per app instance. */
export function rateLimiters() {
  return { api: limiter(LIMITS.api), login: limiter(LIMITS.login), value: limiter(LIMITS.value) };
}
