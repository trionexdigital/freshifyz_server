import 'dotenv/config';
import { loadConfig } from '../src/server/config/environment';
import { Database } from '../src/server/db/postgres';
import { logger } from '../src/server/utils/logger';

async function main(): Promise<void> {
  const database = new Database(loadConfig().database, logger);
  try {
    await database.checkConnection();
    const result = await database.query('SELECT current_database() AS database, current_user AS role, current_schema() AS schema');
    console.log(JSON.stringify({ success: true, ...result.rows[0] }));
  } finally { await database.close(); }
}

void main().catch(() => { logger.error('database_check_failed'); process.exitCode = 1; });
