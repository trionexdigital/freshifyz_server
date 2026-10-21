import fs from 'node:fs';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  corsOrigins: string[];
  bodyLimit: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  trustProxyHops: number;
  database: {
    host: string;
    port: number;
    database: 'freshifyz';
    user: 'freshifyz_app';
    password: string;
    ssl: false | { rejectUnauthorized: true; ca: string; servername?: string };
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    statementTimeoutMillis: number;
  };
  jwt: { secret: string; issuer: string; audience: string; expiresInSeconds: number };
}

type Environment = Record<string, string | undefined>;

export function loadConfig(env: Environment = process.env): AppConfig {
  const setting = (key: string, fallback?: string, alias?: string): string => {
    const value = env[key];
    const oldValue = alias ? env[alias] : undefined;
    if (value !== undefined && oldValue !== undefined && value !== oldValue) {
      throw new Error(`Conflicting configuration: ${key} and ${alias}`);
    }
    const result = value ?? oldValue ?? fallback;
    if (result === undefined || result.trim() === '') throw new Error(`Missing configuration: ${key}`);
    if (/change[_ -]?me|replace[_ -]?me|your[_ -]?password/i.test(result)) {
      throw new Error(`Replace placeholder configuration: ${key}`);
    }
    return result;
  };
  const integer = (key: string, fallback: number, min: number, max: number, alias?: string): number => {
    const raw = setting(key, String(fallback), alias);
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`Invalid configuration: ${key}`);
    }
    return value;
  };
  const nodeEnv = setting('NODE_ENV', 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const host = setting('PGHOST', '127.0.0.1', 'PG_HOST');
  const database = setting('PGDATABASE', 'freshifyz', 'PG_DATABASE');
  const user = setting('PGUSER', 'freshifyz_app', 'PG_USER');
  if (database !== 'freshifyz') throw new Error('PGDATABASE must be freshifyz');
  if (user !== 'freshifyz_app') throw new Error('PGUSER must be the restricted freshifyz_app role');
  const password = setting('PGPASSWORD', undefined, 'PG_PASSWORD');
  if (password.length < 32) throw new Error('PGPASSWORD must contain at least 32 characters');
  const sslMode = setting('PGSSLMODE', 'disable');
  let ssl: AppConfig['database']['ssl'];
  if (sslMode === 'disable') {
    if (!['127.0.0.1', '::1'].includes(host)) {
      throw new Error('PGSSLMODE=disable requires a literal loopback PGHOST; use SSH forwarding');
    }
    ssl = false;
  } else if (sslMode === 'verify-full') {
    const caPath = setting('PGSSLROOTCERT');
    try {
      ssl = { rejectUnauthorized: true, ca: fs.readFileSync(caPath, 'utf8') };
    } catch {
      throw new Error('Cannot read PGSSLROOTCERT');
    }
    if (env.PGSSL_SERVER_NAME) ssl.servername = env.PGSSL_SERVER_NAME;
  } else {
    throw new Error('PGSSLMODE must be disable or verify-full');
  }
  const secret = setting('JWT_SECRET');
  if (Buffer.byteLength(secret, 'utf8') < 64 || new Set(secret).size < 16 || secret === password) {
    throw new Error('JWT_SECRET must be an independent random secret of at least 64 bytes');
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins, without trailing slashes');
    }
  }
  return {
    nodeEnv: nodeEnv as AppConfig['nodeEnv'],
    host: setting('HOST', '127.0.0.1'),
    port: integer('PORT', 4000, 1, 65535, 'NODE_EXPRESS_PORT'),
    corsOrigins,
    bodyLimit: integer('BODY_LIMIT_BYTES', 16384, 1024, 1048576),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
    rateLimitMax: integer('RATE_LIMIT_MAX', 120, 1, 100000),
    trustProxyHops: integer('TRUST_PROXY_HOPS', 0, 0, 5),
    database: {
      host,
      port: integer('PGPORT', 65432, 1, 65535, 'PG_PORT'),
      database,
      user,
      password,
      ssl,
      max: integer('PGPOOL_MAX', 5, 1, 10),
      connectionTimeoutMillis: integer('PG_CONNECTION_TIMEOUT_MS', 5000, 100, 30000),
      idleTimeoutMillis: integer('PG_IDLE_TIMEOUT_MS', 30000, 1000, 300000),
      statementTimeoutMillis: integer('PG_STATEMENT_TIMEOUT_MS', 5000, 100, 30000),
    },
    jwt: {
      secret,
      issuer: setting('JWT_ISSUER', 'freshifyz'),
      audience: setting('JWT_AUDIENCE', 'freshifyz-api'),
      expiresInSeconds: integer('JWT_EXPIRES_IN_SECONDS', 900, 60, 3600),
    },
  };
}
