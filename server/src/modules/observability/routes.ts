import type { FastifyInstance } from 'fastify';
import type { HealthSnapshot } from './observability.types.js';
import type { ObservabilityMetricsRegistry } from './metrics.js';
import { createHealthySnapshot } from './health.js';

export type ObservabilityRoutesDeps = {
  app: FastifyInstance;
  serviceName: string;
  metrics: ObservabilityMetricsRegistry;
  getReadiness?: () => HealthSnapshot | Promise<HealthSnapshot>;
  getLiveness?: () => HealthSnapshot | Promise<HealthSnapshot>;
};

export function registerObservabilityRoutes({
  app,
  serviceName,
  metrics,
  getReadiness,
  getLiveness,
}: ObservabilityRoutesDeps): void {
  app.get('/health/live', async () => {
    return {
      ok: true,
      data: (await getLiveness?.()) ?? createHealthySnapshot(serviceName, 'liveness'),
    };
  });

  app.get('/health/ready', async () => {
    return {
      ok: true,
      data: (await getReadiness?.()) ?? createHealthySnapshot(serviceName, 'readiness'),
    };
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return metrics.renderPrometheus();
  });
}
