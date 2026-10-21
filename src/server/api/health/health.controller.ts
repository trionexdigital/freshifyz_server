import type { RequestHandler } from 'express';
import { asyncHandler, failure, success } from '../../utils/http';
import { HealthService } from './health.service';

export class HealthController {
  constructor(private readonly service: HealthService) {}

  liveness: RequestHandler = (_req, res) => { success(res, this.service.liveness()); };

  readiness = asyncHandler(async (_req, res) => {
    if (await this.service.readiness()) success(res, { service: 'freshifyz', status: 'ready' });
    else failure(res, 503, 'NOT_READY', 'Service is not ready');
  });
}
