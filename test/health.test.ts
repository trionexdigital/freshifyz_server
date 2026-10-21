import request from 'supertest';
import express from 'express';
import { createApp } from '../src/server/app';
import { asyncHandler } from '../src/server/utils/http';
import { errorHandler } from '../src/server/middleware/error.middleware';
import { testConfig, testLogger } from './helpers';

describe('Freshifyz HTTP application', () => {
  const database = { checkConnection: jest.fn<Promise<void>, []>() };
  const logger = testLogger();
  const config = testConfig();
  beforeEach(() => { database.checkConnection.mockReset().mockResolvedValue(undefined); });

  test('liveness is public, independent of PostgreSQL, and has security headers', async () => {
    database.checkConnection.mockRejectedValue(new Error('private connection string'));
    const result = await request(createApp(config, database, logger)).get('/api/health');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { service: 'freshifyz', status: 'ok' } });
    expect(result.body.timestamp).toEqual(expect.any(String));
    expect(result.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.headers['x-content-type-options']).toBe('nosniff');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['x-powered-by']).toBeUndefined();
    expect(database.checkConnection).not.toHaveBeenCalled();
  });

  test('readiness checks PostgreSQL and returns 200', async () => {
    const result = await request(createApp(config, database, logger)).get('/api/health/ready');
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ service: 'freshifyz', status: 'ready' });
    expect(database.checkConnection).toHaveBeenCalledTimes(1);
  });

  test('database failure returns a sanitized 503', async () => {
    database.checkConnection.mockRejectedValue(new Error('private-host:5432 password=private'));
    const result = await request(createApp(config, database, logger)).get('/api/health/ready');
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('NOT_READY');
    expect(result.text).not.toContain('private');
    expect(logger.error).toHaveBeenCalledWith('database_readiness_failed');
  });

  test('unknown routes and non-GET health requests return 404', async () => {
    const app = createApp(config, database, logger);
    for (const path of ['/auth/login', '/api/users', '/v1/dashboard', '/api/health/unknown']) {
      expect((await request(app).get(path)).status).toBe(404);
    }
    expect((await request(app).post('/api/health')).status).toBe(404);
  });

  test('CORS allows only configured exact origins and supports preflight', async () => {
    const app = createApp(config, database, logger);
    const allowed = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const denied = await request(app).get('/api/health').set('Origin', 'https://untrusted.example');
    expect(denied.status).toBe(403);
    const preflight = await request(app).options('/api/health').set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization');
    expect(preflight.status).toBe(204);
    const native = await request(app).get('/api/health');
    expect(native.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('malformed JSON and large bodies use the error envelope', async () => {
    const app = createApp(config, database, logger);
    const invalid = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{private');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('INVALID_JSON');
    expect(invalid.text).not.toContain('private');
    const large = await request(app).post('/api/health').send({ value: 'x'.repeat(config.bodyLimit + 1) });
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('rate limit returns a consistent 429', async () => {
    const app = createApp({ ...config, rateLimitMax: 2 }, database, logger);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
    const limited = await request(app).get('/api/health');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  test('async exceptions are handled without exposing stack traces or secrets', async () => {
    const app = express();
    app.get('/fixture', asyncHandler(async () => { throw new Error('private password'); }));
    app.use(errorHandler(logger));
    const result = await request(app).get('/fixture');
    expect(result.status).toBe(500);
    expect(result.text).not.toContain('private');
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });
});
