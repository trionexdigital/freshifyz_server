import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/environment';
import type { Logger } from '../utils/logger';

export interface DatabaseHealth {
  checkConnection(): Promise<void>;
}

export class Database implements DatabaseHealth {
  private readonly pool: Pool;

  constructor(config: AppConfig['database'], logger: Logger) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      max: config.max,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      idleTimeoutMillis: config.idleTimeoutMillis,
      statement_timeout: config.statementTimeoutMillis,
      query_timeout: config.statementTimeoutMillis + 1000,
      lock_timeout: Math.min(config.statementTimeoutMillis, 2000),
      idle_in_transaction_session_timeout: 10000,
      application_name: 'freshifyz',
      options: '-c search_path=app',
    });
    this.pool.on('error', () => logger.error('database_pool_error'));
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async checkConnection(): Promise<void> {
    await this.query('SELECT 1');
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
