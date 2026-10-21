import { Router } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

export function healthRoutes(service: HealthService): Router {
  const router = Router();
  const controller = new HealthController(service);
  router.get('/', controller.liveness);
  router.get('/ready', controller.readiness);
  return router;
}
