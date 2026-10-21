import type { AuthIdentity } from '../security/jwt';

declare global {
  namespace Express {
    interface Request { auth?: AuthIdentity }
  }
}

export {};
