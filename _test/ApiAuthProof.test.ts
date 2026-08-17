import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { SignJWT } from 'jose';
import { createSecretKey } from 'crypto';
import { requireAuthProof } from '@server/middleware/requireAuthProof';

// These cover the synchronous guard branches only — no crypto/wallet needed.
// (protoWallet is lazy-imported AFTER these guards, so the key is never required here.)
// Port of the old src/utils/apiAuthProof.ts test, against the Express
// middleware that superseded it: server/middleware/requireAuthProof.ts.

const SECRET = 'z'.repeat(32);

async function makeToken(payload: Record<string, unknown>, expires: string): Promise<string> {
  const jwt = new SignJWT(payload);
  jwt.setProtectedHeader({ alg: 'HS256' });
  jwt.setExpirationTime(expires);
  return jwt.sign(createSecretKey(Buffer.from(SECRET, 'utf-8')));
}

function harness() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.post('/guarded', requireAuthProof('p'), (_req, res) => { res.json({ ok: true }); });
  return app;
}

describe('requireAuthProof: synchronous guard branches', () => {
  const original = process.env.JWT_SECRET;
  beforeEach(() => { process.env.JWT_SECRET = SECRET; });
  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  test('missing proof → 401', async () => {
    const token = await makeToken({ user: 'user1' }, '1d');
    const res = await request(harness())
      .post('/guarded')
      .set('Cookie', `verified=${token}`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth proof' });
  });

  test('non-string walletIdentityKey → 401', async () => {
    const token = await makeToken({ user: 'user1' }, '1d');
    const res = await request(harness())
      .post('/guarded')
      .set('Cookie', `verified=${token}`)
      .send({ proof: { sig: 'x' }, walletIdentityKey: 123 });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing auth proof' });
  });
});
