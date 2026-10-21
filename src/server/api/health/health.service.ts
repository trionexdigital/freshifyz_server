import type { DatabaseHealth } from '../../db/postgres';
import type { Logger } from '../../utils/logger';

export class HealthService {
  constructor(private readonly database: DatabaseHealth, private readonly logger: Logger) {}

  liveness() {
    return { service: 'freshifyz', status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  async readiness(): Promise<boolean> {
    try {
      await this.database.checkConnection();
      return true;
    } catch {
      this.logger.error('database_readiness_failed');
      return false;
    }
  }
}
