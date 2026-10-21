import 'dotenv/config';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { loadConfig } from '../src/server/config/environment';
import { Database } from '../src/server/db/postgres';
import { logger } from '../src/server/utils/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.database, logger);
  try {
    const { rows: [state] } = await database.query(`SELECT
      current_database() AS database, current_user AS role, current_schema() AS schema,
      has_database_privilege(current_user, 'freshifyz', 'CREATE') AS database_create,
      has_database_privilege(current_user, 'freshifyz', 'TEMP') AS temporary_tables,
      has_schema_privilege(current_user, 'app', 'CREATE') AS schema_create,
      has_database_privilege(current_user, 'cook_and_eat', 'CONNECT') AS existing_database_access,
      pg_has_role(current_user, 'freshifyz_owner', 'MEMBER') AS owner_membership`);
    assert.deepEqual(state, { database: 'freshifyz', role: 'freshifyz_app', schema: 'app',
      database_create: false, temporary_tables: false, schema_create: false,
      existing_database_access: false, owner_membership: false });
    const roles = await database.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`);
    assert.ok(Object.values(roles.rows[0]!).every(value => value === false));
    assert.equal((await database.query('SELECT $1::text AS value', ["safe'parameter"])).rows[0]!.value, "safe'parameter");
    assert.equal(await database.transaction(async client => (await client.query('SELECT 42 AS value')).rows[0].value), 42);
    await assert.rejects(database.transaction(async client => {
      await client.query('CREATE TABLE app.__freshifyz_permission_probe (id integer)');
    }), (error: unknown) => (error as { code?: string }).code === '42501');
    const forbidden = new Client({ host: config.database.host, port: config.database.port,
      user: config.database.user, password: config.database.password, ssl: config.database.ssl,
      database: 'cook_and_eat', connectionTimeoutMillis: config.database.connectionTimeoutMillis });
    try {
      await assert.rejects(forbidden.connect(), (error: unknown) =>
        ['28000', '42501'].includes((error as { code: string }).code));
    } finally { await forbidden.end(); }
    console.log(JSON.stringify({ success: true, database: 'freshifyz', restrictedRoleVerified: true,
      existingDatabaseAccessDenied: true, parameterizedQueriesVerified: true, transactionVerified: true }));
  } finally { await database.close(); }
}

void main().catch(() => { logger.error('database_verification_failed'); process.exitCode = 1; });
