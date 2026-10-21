import type { ErrorRequestHandler, RequestHandler } from 'express';
import { failure, HttpError } from '../utils/http';
import type { Logger } from '../utils/logger';

export const notFound: RequestHandler = (_req, res) => {
  failure(res, 404, 'NOT_FOUND', 'Route not found');
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') return failure(res, 400, 'INVALID_JSON', 'Invalid JSON body');
    if (type === 'entity.too.large') return failure(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
      return failure(res, 415, 'UNSUPPORTED_ENCODING', 'Unsupported request encoding');
    }
    if (error instanceof HttpError) {
      if (error.statusCode === 401) res.setHeader('WWW-Authenticate', 'Bearer');
      return failure(res, error.statusCode, error.code, error.message);
    }
    logger.error('request_error', { requestId: res.locals.requestId });
    failure(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  };
}
