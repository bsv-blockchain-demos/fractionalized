import request from 'supertest';
import { buildApp } from '@server/app';
import { errorHandler } from '@server/middleware/errorHandler';

const ORIGIN = 'http://localhost:5173';

describe('buildApp', () => {
  const original = process.env.ALLOWED_ORIGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = original;
  });

  test('GET /api/health returns ok', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('echoes an allowlisted Origin with credentials', async () => {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    const res = await request(buildApp()).get('/api/health').set('Origin', ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['vary']).toContain('Origin');
  });

  test('does NOT echo a non-allowlisted Origin', async () => {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    const res = await request(buildApp()).get('/api/health').set('Origin', 'http://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('answers preflight with 204', async () => {
    process.env.ALLOWED_ORIGINS = ORIGIN;
    const res = await request(buildApp()).options('/api/health').set('Origin', ORIGIN);
    expect(res.status).toBe(204);
  });

  test('accepts a JSON body larger than the 100kb default', async () => {
    const app = buildApp();
    app.post('/api/echo-size', (req, res) => { res.json({ size: (req.body.blob as string).length }); });
    const blob = 'x'.repeat(500_000);
    const res = await request(app).post('/api/echo-size').send({ blob });
    expect(res.status).toBe(200);
    expect(res.body.size).toBe(500_000);
  });

  test('errorHandler responds 500 with a generic message, and no-ops once headers are sent', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status, json, headersSent: false } as unknown as import('express').Response;

    errorHandler(new Error('boom'), {} as import('express').Request, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });

    const status2 = jest.fn();
    const json2 = jest.fn();
    const sentRes = { status: status2, json: json2, headersSent: true } as unknown as import('express').Response;

    errorHandler(new Error('boom again'), {} as import('express').Request, sentRes, jest.fn());

    expect(status2).not.toHaveBeenCalled();
    expect(json2).not.toHaveBeenCalled();
  });

  test('errorHandler responds with a 400-499 status carried on the error, using its own message', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status, json, headersSent: false } as unknown as import('express').Response;

    const err = Object.assign(new SyntaxError('Unexpected token in JSON'), { status: 400 });
    errorHandler(err, {} as import('express').Request, res, jest.fn());

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'Unexpected token in JSON' });
  });

  test('errorHandler treats statusCode the same as status', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status, json, headersSent: false } as unknown as import('express').Response;

    const err = Object.assign(new Error('nope'), { statusCode: 404 });
    errorHandler(err, {} as import('express').Request, res, jest.fn());

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: 'nope' });
  });

  test('errorHandler still responds 500 with the generic body for an out-of-range or missing status', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status, json, headersSent: false } as unknown as import('express').Response;

    const err = Object.assign(new Error('weird'), { status: 599 });
    errorHandler(err, {} as import('express').Request, res, jest.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  test('errorHandler still no-ops for a 400-carrying error once headers are sent', () => {
    const status = jest.fn();
    const json = jest.fn();
    const sentRes = { status, json, headersSent: true } as unknown as import('express').Response;

    const err = Object.assign(new Error('too late'), { status: 400 });
    errorHandler(err, {} as import('express').Request, sentRes, jest.fn());

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
