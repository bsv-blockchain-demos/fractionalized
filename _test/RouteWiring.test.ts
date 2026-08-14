import request from 'supertest';
import { buildApp } from '@server/app';

/**
 * Wiring test: Tasks 5-11 verified route BODIES against their Next sources
 * verbatim, deliberately with no automated test (a unit test over a verbatim
 * copy just re-asserts the copy against itself). What that left unpinned is
 * the WIRING — mount paths and per-route guard presence — which was only
 * ever checked by hand via a buildApp() boot.
 *
 * This test builds the real app and calls every guarded endpoint with NO
 * cookie. A 401 proves two things at once: the path is actually mounted (a
 * typo'd/missing mount path would 404, not 401) and a guard is actually
 * present (a dropped guard would fall through to handler logic and likely
 * 200/500, not 401). Every guard here (requireSession, and
 * requireAuthProof which itself checks the session cookie first) rejects
 * before any DB or wallet access, so this suite needs no Mongo connection —
 * confirmed by tracing each handler's guard chain (see server/middleware/
 * requireSession.ts and requireAuthProof.ts: both return 401 immediately
 * when req.cookies.verified is absent, before touching config, Mongo, or the
 * wallet).
 */

type Method = 'get' | 'post';

const GUARDED_ENDPOINTS: Array<{ method: Method; path: string }> = [
  { method: 'post', path: '/api/tokenize/create-property' },
  { method: 'post', path: '/api/share-purchase' },
  { method: 'post', path: '/api/listing-purchase' },
  { method: 'post', path: '/api/new-listing' },
  { method: 'post', path: '/api/cancel-listing' },
  { method: 'post', path: '/api/my-shares' },
  { method: 'post', path: '/api/my-listings' },
  { method: 'post', path: '/api/my-selling' },
  { method: 'post', path: '/api/properties' },
  { method: 'get', path: '/api/properties' },
  { method: 'get', path: '/api/properties/000000000000000000000000' },
  { method: 'get', path: '/api/listings' },
];

describe('route wiring: guarded endpoints reject with no cookie', () => {
  test.each(GUARDED_ENDPOINTS)('$method $path -> 401 with no cookie', async ({ method, path }) => {
    const app = buildApp();
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });
});

describe('route wiring: unguarded endpoints stay reachable with no session', () => {
  test('GET /api/health -> 200 { status: "ok" }', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('GET /api/check-session -> 200 { authenticated: false } (never 401 - see auth.ts, avoids a redirect loop)', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/check-session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });
});
