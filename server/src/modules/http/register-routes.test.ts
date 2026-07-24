import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import {
  registerRequestErrorHandler,
  telemetryHistoryQuerySchema,
  thresholdJobParamsSchema,
  zoneIdParamsSchema,
  zoneListQuerySchema,
} from './register-routes.js';

async function createValidationApp() {
  const app = Fastify({ logger: false });
  registerRequestErrorHandler(app);
  app.get('/api/zones', async (request) => zoneListQuerySchema.parse(request.query));
  app.get('/api/zones/:zoneId', async (request) => zoneIdParamsSchema.parse(request.params));
  app.get('/api/analysis/threshold-jobs/:jobId', async (request) =>
    thresholdJobParamsSchema.parse(request.params));
  app.get('/api/devices/:deviceId/telemetry', async (request) =>
    telemetryHistoryQuerySchema.parse(request.query));
  await app.ready();
  return app;
}

test('invalid route input returns a sanitized 422 response', async (context) => {
  const app = await createValidationApp();
  context.after(() => app.close());

  for (const url of [
    '/api/zones?sortBy=updatedAt',
    '/api/zones/not-a-number',
    '/api/analysis/threshold-jobs/not-a-uuid',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 422, url);
    const body = response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'validation_failed');
    assert.ok(Array.isArray(body.issues));
    assert.equal(typeof body.issues[0]?.field, 'string');
    assert.equal(typeof body.issues[0]?.code, 'string');
    assert.doesNotMatch(response.body, /pattern|regex|stack|expected|received|Invalid UUID/i);
  }
});

test('telemetry date range requires valid ordered ISO datetimes', async (context) => {
  const app = await createValidationApp();
  context.after(() => app.close());

  for (const url of [
    '/api/devices/ESP-1/telemetry?from=not-a-date&to=2026-07-23T00:00:00.000Z',
    '/api/devices/ESP-1/telemetry?from=2026-07-24T00:00:00.000Z&to=2026-07-23T00:00:00.000Z',
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 422, url);
    assert.equal(response.json().error, 'validation_failed');
  }

  const response = await app.inject({
    method: 'GET',
    url: '/api/devices/ESP-1/telemetry?from=2026-07-23T00:00:00.000Z&to=2026-07-23T00:00:00.000Z',
  });
  assert.equal(response.statusCode, 200);
});
