import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import type { AppConfig } from './config/environment';
import type { DatabaseHealth } from './db/postgres';
import { healthRoutes } from './api/health/health.routes';
import { HealthService } from './api/health/health.service';
import { errorHandler, notFound } from './middleware/error.middleware';
import { failure, HttpError } from './utils/http';
import type { Logger } from './utils/logger';

export function createApp(config: AppConfig, database: DatabaseHealth, logger: Logger) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.requestId);
    res.setHeader('Cache-Control', 'no-store');
    const start = performance.now();
    res.once('finish', () => logger.info('request_complete', {
      requestId: res.locals.requestId, method: req.method, statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - start),
    }));
    next();
  });
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, false);
      if (config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['X-Request-Id'], credentials: false, maxAge: 600,
  }));
  app.use(rateLimit({
    windowMs: config.rateLimitWindowMs, limit: config.rateLimitMax,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => failure(res, 429, 'RATE_LIMITED', 'Too many requests'),
  }));
  app.use(express.json({ limit: config.bodyLimit, strict: true }));
  app.use(compression());
  app.use('/api/health', healthRoutes(new HealthService(database, logger)));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
