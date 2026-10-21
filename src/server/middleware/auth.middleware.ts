import type { RequestHandler } from 'express';
import { TokenService } from '../security/jwt';
import { HttpError } from '../utils/http';

export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    try {
      const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '');
      if (!match?.[1] || match[1].length > 8192) {
        throw new HttpError(401, 'UNAUTHORIZED', 'A valid bearer token is required');
      }
      req.auth = tokens.verify(match[1]);
      next();
    } catch (error) { next(error); }
  };
}

// Role guards accept any listed role; permission guards require every listed permission.
export function requireRoles(...roles: string[]): RequestHandler {
  if (roles.length === 0 || roles.some(role => !role.trim())) throw new Error('A role guard requires explicit roles');
  return (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required'));
    if (!roles.some(role => req.auth!.roles.includes(role))) return next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'));
    next();
  };
}

export function requirePermissions(...permissions: string[]): RequestHandler {
  if (permissions.length === 0 || permissions.some(permission => !permission.trim())) throw new Error('A permission guard requires explicit permissions');
  return (req, _res, next) => {
    if (!req.auth) return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication is required'));
    if (!permissions.every(permission => req.auth!.permissions.includes(permission))) return next(new HttpError(403, 'FORBIDDEN', 'Insufficient permissions'));
    next();
  };
}
