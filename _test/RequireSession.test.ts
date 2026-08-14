import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { createSecretKey } from 'crypto';
import { requireSession } from '@server/middleware/requireSession';

const SECRET = 'z'.repeat(32);

async function makeToken(payload: Record<string, unknown>, expires: string): Promise<string> {
  const jwt = new SignJWT(payload);
  jwt.setProtectedHeader({ alg: 'HS256' });
  jwt.setExpirationTime(expires);
  return jwt.sign(createSecretKey(Buffer.from(SECRET, 'utf-8')));
}

function harness() {
  const app = express();
  app.use(cookieParser());
  app.get('/guarded', requireSession, (req, res) => { res.json({ userId: req.userId }); });
  return app;
}

describe('requireSession', () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => { process.env.JWT_SECRET = SECRET; });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  test('sets req.userId for a valid token', async () => {
    const token = await makeToken({ user: '02abc' }, '1d');
    const res = await request(harness()).get('/guarded').set('Cookie', `verified=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: '02abc' });
  });

  test('401s with no cookie and clears nothing', async () => {
    const res = await request(harness()).get('/guarded');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('401s AND clears the cookie for a tampered token', async () => {
    const res = await request(harness()).get('/guarded').set('Cookie', 'verified=not-a-jwt');
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'])).toMatch(/verified=;.*HttpOnly.*Secure.*SameSite=Strict/i);
  });

  test('401s AND clears the cookie for an expired token', async () => {
    const token = await makeToken({ user: '02abc' }, '-1s');
    const res = await request(harness()).get('/guarded').set('Cookie', `verified=${token}`);
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'])).toMatch(/verified=;.*HttpOnly.*Secure.*SameSite=Strict/i);
  });

  test('401s AND clears the cookie for a signed token with no user claim', async () => {
    const token = await makeToken({ notUser: 'x' }, '1d');
    const res = await request(harness()).get('/guarded').set('Cookie', `verified=${token}`);
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'])).toMatch(/verified=;.*HttpOnly.*Secure.*SameSite=Strict/i);
  });
});
