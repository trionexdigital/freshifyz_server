import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { TokenService } from '../src/server/security/jwt';
import { authenticate, requirePermissions, requireRoles } from '../src/server/middleware/auth.middleware';
import { errorHandler } from '../src/server/middleware/error.middleware';
import { testConfig, testLogger } from './helpers';

describe('JWT authentication and authorization', () => {
  const config = testConfig();
  const tokens = new TokenService(config.jwt);
  const identity = { userId: 'test-user', roles: ['admin'], permissions: ['profile:read', 'profile:write'] };
  const app = express();
  // These routes exist only in this test fixture, never in the production app.
  app.get('/protected', authenticate(tokens), requireRoles('admin', 'operator'),
    requirePermissions('profile:read', 'profile:write'), (req, res) => { res.json(req.auth); });
  app.get('/guard-only', requireRoles('admin'), (_req, res) => { res.sendStatus(200); });
  app.use(errorHandler(testLogger()));

  test('valid tokens populate immutable identity without renewing tokens', async () => {
    const token = tokens.sign(identity);
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(900);
    expect(decoded.iss).toBe('freshifyz');
    expect(decoded.aud).toBe('freshifyz-api');
    const result = await request(app).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(identity);
    expect(result.headers.token).toBeUndefined();
    expect(Object.isFrozen(tokens.verify(token).roles)).toBe(true);
  });

  test.each(['', 'Basic abc', 'Bearer not-a-jwt', 'Bearer a.b.c', 'Bearer a.b.c extra'])('rejects malformed authorization: %s', async header => {
    const result = await request(app).get('/protected').set('Authorization', header);
    expect(result.status).toBe(401);
    expect(result.headers['www-authenticate']).toBe('Bearer');
    expect(result.body.error.code).toBe('UNAUTHORIZED');
  });

  test('rejects tampering and unexpected signature algorithms', async () => {
    const original = tokens.sign(identity);
    const parts = original.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'attacker', roles: ['admin'] })).toString('base64url');
    for (const token of [parts.join('.'), jwt.sign({ sub: identity.userId, roles: identity.roles, permissions: identity.permissions }, config.jwt.secret, { algorithm: 'HS512', issuer: config.jwt.issuer, audience: config.jwt.audience, expiresIn: 900 })]) {
      expect((await request(app).get('/protected').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    }
  });

  test('rejects expired, missing, future, or malformed identity claims and wrong issuer/audience', () => {
    const now = Math.floor(Date.now() / 1000);
    const base = { sub: identity.userId, roles: identity.roles, permissions: identity.permissions };
    const options: jwt.SignOptions = { algorithm: 'HS256', issuer: config.jwt.issuer, audience: config.jwt.audience };
    const invalid = [
      jwt.sign({ ...base, iat: now - 100, exp: now - 1 }, config.jwt.secret, options),
      jwt.sign(base, config.jwt.secret, options),
      jwt.sign({ ...base, exp: now + 100 }, config.jwt.secret, { ...options, noTimestamp: true }),
      jwt.sign({ ...base, iat: now + 100, exp: now + 200 }, config.jwt.secret, options),
      jwt.sign({ ...base, roles: 'admin', exp: now + 100 }, config.jwt.secret, options),
      jwt.sign({ ...base, permissions: [123], exp: now + 100 }, config.jwt.secret, options),
      jwt.sign({ ...base, sub: '', exp: now + 100 }, config.jwt.secret, options),
      jwt.sign({ ...base, exp: now + 100 }, config.jwt.secret, { ...options, issuer: 'other' }),
      jwt.sign({ ...base, exp: now + 100 }, config.jwt.secret, { ...options, audience: 'other' }),
    ];
    for (const token of invalid) expect(() => tokens.verify(token)).toThrow('valid bearer token');
  });

  test('accepts any required role but requires all permissions', async () => {
    const noRole = tokens.sign({ ...identity, roles: ['viewer'] });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${noRole}`)).status).toBe(403);
    const missingPermission = tokens.sign({ ...identity, permissions: ['profile:read'] });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${missingPermission}`)).status).toBe(403);
    const operator = tokens.sign({ ...identity, roles: ['operator'] });
    expect((await request(app).get('/protected').set('Authorization', `Bearer ${operator}`)).status).toBe(200);
    expect((await request(app).get('/guard-only')).status).toBe(401);
    expect(() => requireRoles()).toThrow();
    expect(() => requirePermissions()).toThrow();
  });
});
