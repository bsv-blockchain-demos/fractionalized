import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { createSecretKey } from 'crypto';
import { checkSessionRouter } from '@server/routes/auth';

const SECRET = 'q'.repeat(32);

async function makeToken(user: string, expires: string): Promise<string> {
  const jwt = new SignJWT({ user });
  jwt.setProtectedHeader({ alg: 'HS256' });
  jwt.setExpirationTime(expires);
  return jwt.sign(createSecretKey(Buffer.from(SECRET, 'utf-8')));
}

function harness() {
  const app = express();
  app.use(cookieParser());
  app.use('/api', checkSessionRouter);
  return app;
}

describe('GET /api/check-session', () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => { process.env.JWT_SECRET = SECRET; });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  test('authenticated: true for a valid session', async () => {
    const token = await makeToken('02abc', '1d');
    const res = await request(harness()).get('/api/check-session').set('Cookie', `verified=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true });
  });

  test('authenticated: false with no cookie', async () => {
    const res = await request(harness()).get('/api/check-session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  test('authenticated: false for an expired token', async () => {
    const token = await makeToken('02abc', '-1s');
    const res = await request(harness()).get('/api/check-session').set('Cookie', `verified=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });
});
