import { Pool } from 'pg';
import { Database } from '../src/server/db/postgres';
import { testConfig, testLogger } from './helpers';

jest.mock('pg', () => ({ Pool: jest.fn() }));

describe('PostgreSQL connection lifecycle', () => {
  const query = jest.fn();
  const release = jest.fn();
  const connect = jest.fn();
  const end = jest.fn();
  const on = jest.fn();
  const mockPool = { query, connect, end, on };
  beforeEach(() => {
    query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    release.mockReset();
    connect.mockReset().mockResolvedValue({ query, release });
    (Pool as unknown as jest.Mock).mockImplementation(() => mockPool);
  });

  test('creates a bounded pool without connecting on import and preserves parameter values', async () => {
    const database = new Database(testConfig().database, testLogger());
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 5, application_name: 'freshifyz', options: '-c search_path=app', statement_timeout: 5000 }));
    expect(connect).not.toHaveBeenCalled();
    const value = "' OR 1=1 --";
    await database.query('SELECT $1::text', [value]);
    expect(query).toHaveBeenCalledWith('SELECT $1::text', [value]);
  });

  test('commits a transaction and releases its connection', async () => {
    const database = new Database(testConfig().database, testLogger());
    expect(await database.transaction(async client => { await client.query('SELECT 1'); return 42; })).toBe(42);
    expect(query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(release).toHaveBeenCalledWith(false);
  });

  test('rolls back a failed transaction and releases its connection', async () => {
    const database = new Database(testConfig().database, testLogger());
    await expect(database.transaction(async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(release).toHaveBeenCalledWith(false);
  });

  test('discards a broken connection if rollback fails', async () => {
    const database = new Database(testConfig().database, testLogger());
    query.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('connection lost'));
    await expect(database.transaction(async () => { throw new Error('operation failed'); })).rejects.toThrow('operation failed');
    expect(release).toHaveBeenCalledWith(true);
  });

  test('pool errors log no credentials and shutdown closes the pool', async () => {
    const logger = testLogger();
    const database = new Database(testConfig().database, logger);
    const callback = on.mock.calls.at(-1)![1] as (error: Error) => void;
    callback(new Error('private password'));
    expect(logger.error).toHaveBeenCalledWith('database_pool_error');
    await database.close();
    expect(end).toHaveBeenCalled();
  });
});
