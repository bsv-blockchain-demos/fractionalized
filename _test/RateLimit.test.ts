import request from 'supertest';
import { buildApp } from '@server/app';
import { LIMITS } from '@server/middleware/rateLimit';

// The limiters run before auth, so unauthenticated calls (401) still count; a 429 means the
// limiter, not the route, answered. No Mongo or wallet: every call stops at a guard or parser.

async function hit(app: ReturnType<typeof buildApp>, n: number, send: (app: ReturnType<typeof buildApp>) => request.Test) {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await send(app)).status);
  return statuses;
}

afterEach(() => { delete process.env.CLIENT_IP_HEADER; });

test('value-moving routes allow LIMITS.value calls per client per window, then 429', async () => {
  const statuses = await hit(buildApp(), LIMITS.value + 1, (app) => request(app).post('/api/share-purchase').send({}));
  expect(statuses.slice(0, LIMITS.value).every((s) => s !== 429)).toBe(true);
  expect(statuses[LIMITS.value]).toBe(429);
});

test('the value limit is shared across the value-moving routes', async () => {
  const app = buildApp();
  await hit(app, LIMITS.value, (a) => request(a).post('/api/new-listing').send({}));
  const res = await request(app).post('/api/cancel-listing/reserve').send({});
  expect(res.status).toBe(429);
  expect(res.body.error).toMatch(/too many/i);
});

test('login has its own limit', async () => {
  const statuses = await hit(buildApp(), LIMITS.login + 1, (app) => request(app).post('/api/auth/login').send({}));
  expect(statuses[LIMITS.login - 1]).not.toBe(429);
  expect(statuses[LIMITS.login]).toBe(429);
});

test('all other /api routes share the general limit', async () => {
  const statuses = await hit(buildApp(), LIMITS.api + 1, (app) => request(app).get('/api/listings'));
  expect(statuses[LIMITS.api - 1]).not.toBe(429);
  expect(statuses[LIMITS.api]).toBe(429);
});

test('health and readiness probes are never limited', async () => {
  const statuses = await hit(buildApp(), LIMITS.api + 5, (app) => request(app).get('/api/health'));
  expect(statuses.every((s) => s === 200)).toBe(true);
});

test('with CLIENT_IP_HEADER set, clients are told apart by that header', async () => {
  process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';
  const app = buildApp();
  await hit(app, LIMITS.value, (a) => request(a).post('/api/share-purchase').set('CF-Connecting-IP', '203.0.113.1').send({}));
  const other = await request(app).post('/api/share-purchase').set('CF-Connecting-IP', '203.0.113.2').send({});
  expect(other.status).not.toBe(429);
  const same = await request(app).post('/api/share-purchase').set('CF-Connecting-IP', '203.0.113.1').send({});
  expect(same.status).toBe(429);
});

test('without CLIENT_IP_HEADER, a spoofed CF-Connecting-IP does not reset the limit', async () => {
  const app = buildApp();
  let i = 0;
  const statuses = await hit(app, LIMITS.value + 1, (a) => request(a).post('/api/share-purchase').set('CF-Connecting-IP', `203.0.113.${++i}`).send({}));
  expect(statuses[LIMITS.value]).toBe(429);
});
