import 'dotenv/config';
import http from 'node:http';
import { createApp } from './server/app';
import { loadConfig } from './server/config/environment';
import { Database } from './server/db/postgres';
import { logger } from './server/utils/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.database, logger);
  try { await database.checkConnection(); } catch {
    await database.close();
    throw new Error('PostgreSQL startup check failed');
  }
  const server = http.createServer(createApp(config, database, logger));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  let stopping = false;
  const shutdown = (signal: string, exitCode: number) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutdown_started', { signal });
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
    deadline.unref();
    server.close(() => {
      void database.close().then(() => {
        clearTimeout(deadline);
        process.exitCode = exitCode;
      }).catch(() => process.exit(1));
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', () => shutdown('SIGINT', 0));
  process.once('SIGTERM', () => shutdown('SIGTERM', 0));
  process.once('uncaughtException', () => { logger.error('uncaught_exception'); shutdown('uncaughtException', 1); });
  process.once('unhandledRejection', () => { logger.error('unhandled_rejection'); shutdown('unhandledRejection', 1); });
  server.on('error', () => { logger.error('http_server_error'); shutdown('serverError', 1); });
  server.listen(config.port, config.host, () => logger.info('server_started', { port: config.port, host: config.host }));
}

void main().catch(() => {
  // Fail closed without printing configuration, driver errors, or secrets.
  logger.error('startup_failed_check_configuration_and_database');
  process.exitCode = 1;
});
