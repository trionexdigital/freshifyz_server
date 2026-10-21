import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function success(res: Response, data: unknown): void {
  res.json({ success: true, data, timestamp: new Date().toISOString() });
}

export function failure(res: Response, statusCode: number, code: string, message: string): void {
  res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId: res.locals.requestId,
    timestamp: new Date().toISOString(),
  });
}

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler {
  return (req, res, next) => { void handler(req, res, next).catch(next); };
}
