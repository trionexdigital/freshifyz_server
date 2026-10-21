import fs from 'node:fs';
import { loadConfig } from '../src/server/config/environment';
import { testEnv } from './helpers';

describe('Configuration safety', () => {
  test('defaults target only the isolated database and local SSH tunnel', () => {
    const config = loadConfig(testEnv());
    expect(config).toMatchObject({ host: '127.0.0.1', port: 4000 });
    expect(config.database).toMatchObject({ host: '127.0.0.1', port: 65432, database: 'freshifyz', user: 'freshifyz_app', ssl: false, max: 5 });
    expect(config.jwt.expiresInSeconds).toBe(900);
  });

  test('legacy PostgreSQL keys work only when unambiguous', () => {
    const env = testEnv();
    env.PG_PASSWORD = env.PGPASSWORD!;
    delete env.PGPASSWORD;
    env.PG_HOST = '127.0.0.1';
    env.PG_PORT = '55432';
    expect(loadConfig(env).database.port).toBe(55432);
    expect(() => loadConfig({ ...env, PGHOST: '127.0.0.2' })).toThrow('Conflicting');
  });

  test('conflicting canonical and legacy settings fail closed', () => {
    expect(() => loadConfig({ ...testEnv(), PGPORT: '55432', PG_PORT: '65432' })).toThrow('Conflicting');
    expect(() => loadConfig({ ...testEnv(), PORT: '4000', NODE_EXPRESS_PORT: '3000' })).toThrow('Conflicting');
  });

  test('remote TLS requires certificate verification and supports a forwarded server identity', () => {
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('trusted-public-ca');
    try {
      const config = loadConfig({ ...testEnv(), PGHOST: 'database.example.com', PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: '/trusted/ca.crt', PGSSL_SERVER_NAME: 'database.example.com' });
      expect(config.database.ssl).toEqual({ rejectUnauthorized: true, ca: 'trusted-public-ca', servername: 'database.example.com' });
      expect(read).toHaveBeenCalledWith('/trusted/ca.crt', 'utf8');
    } finally { read.mockRestore(); }
  });

  test.each([
    { PGDATABASE: 'other_database' }, { PGUSER: 'postgres' }, { PGPORT: 'NaN' },
    { PGPORT: '70000' }, { PORT: '0' }, { PGPOOL_MAX: '11' }, { TRUST_PROXY_HOPS: 'true' },
    { PGPASSWORD: '' }, { PGPASSWORD: 'REPLACE_ME' }, { JWT_SECRET: '' },
    { JWT_SECRET: 'x'.repeat(128) }, { JWT_EXPIRES_IN_SECONDS: '86400' },
    { CORS_ORIGINS: '*' }, { CORS_ORIGINS: 'https://example.com/' },
    { PGHOST: '72.61.240.123', PGSSLMODE: 'disable' },
    { PGHOST: 'localhost', PGSSLMODE: 'disable' }, { PGSSLMODE: 'require' },
    { PGSSLMODE: 'verify-full', PGSSLROOTCERT: './missing-ca.crt' },
    { NODE_ENV: 'unknown' },
  ])('rejects unsafe configuration %j', override => {
    expect(() => loadConfig({ ...testEnv(), ...override })).toThrow();
  });

  test('database and JWT secrets must differ', () => {
    const env = testEnv();
    env.JWT_SECRET = env.PGPASSWORD!;
    expect(() => loadConfig(env)).toThrow('independent');
  });
});
