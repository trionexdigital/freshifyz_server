import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/environment';
import { HttpError } from '../utils/http';

export interface AuthIdentity {
  userId: string;
  roles: readonly string[];
  permissions: readonly string[];
}

function validList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 100 && value.every(item =>
    typeof item === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,99}$/.test(item));
}

function validIdentity(identity: AuthIdentity): boolean {
  return typeof identity.userId === 'string' && identity.userId.trim().length > 0 && identity.userId.length <= 128
    && validList(identity.roles) && validList(identity.permissions);
}

export class TokenService {
  constructor(private readonly config: AppConfig['jwt']) {}

  sign(identity: AuthIdentity): string {
    if (!validIdentity(identity)) throw new Error('Invalid token identity');
    return jwt.sign({ roles: identity.roles, permissions: identity.permissions }, this.config.secret, {
      algorithm: 'HS256', subject: identity.userId,
      issuer: this.config.issuer, audience: this.config.audience,
      expiresIn: this.config.expiresInSeconds,
    });
  }

  verify(token: string): AuthIdentity {
    try {
      const payload = jwt.verify(token, this.config.secret, {
        algorithms: ['HS256'], issuer: this.config.issuer, audience: this.config.audience,
        maxAge: this.config.expiresInSeconds,
      });
      if (typeof payload === 'string' || !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat)) {
        throw new Error('Invalid claims');
      }
      const identity = { userId: payload.sub as string, roles: payload.roles, permissions: payload.permissions };
      if (!validIdentity(identity) || payload.exp! <= payload.iat! || payload.iat! > Math.floor(Date.now() / 1000)) {
        throw new Error('Invalid claims');
      }
      return Object.freeze({ ...identity, roles: Object.freeze([...identity.roles]), permissions: Object.freeze([...identity.permissions]) });
    } catch {
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required');
    }
  }
}
