import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/server/config/environment';

export function testEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PGPASSWORD: randomBytes(48).toString('base64url'),
    JWT_SECRET: randomBytes(64).toString('hex'),
    CORS_ORIGINS: 'http://localhost:5173',
  };
}

export const testConfig = () => loadConfig(testEnv());
export const testLogger = () => ({ info: jest.fn(), error: jest.fn() });
