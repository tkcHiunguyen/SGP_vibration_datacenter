import assert from 'node:assert/strict';
import test from 'node:test';
import type { Socket } from 'socket.io';

import { registerSensorStatusHandlers } from './sensor-status.handlers.js';
import type { RegisterSocketHandlersDeps } from './socket-handler.types.js';

type RegisteredHandler = (payload: unknown) => Promise<void> | void;

function createHarness() {
  const handlers = new Map<string, RegisteredHandler>();
  const updates: unknown[] = [];
  const broadcasts: unknown[] = [];
  const socket = {
    id: 'socket-1',
    on(event: string, handler: RegisteredHandler) {
      handlers.set(event, handler);
    },
  } as unknown as Socket;
  const deps = {
    app: {
      log: { warn: () => undefined },
    },
    deviceService: {
      async updateAdxlHealth(_deviceId: string, input: unknown) {
        updates.push(input);
        return {
          updated: true,
          health: {
            status: 'fault' as const,
            reason: 'i2c_read_error' as const,
            captureTimeoutCount: 0,
            i2cReadErrorCount: 1,
            updatedAt: '2026-07-17T00:00:00.000Z',
          },
        };
      },
    },
    realtimeGateway: {
      broadcastDeviceSensorStatus(payload: unknown) {
        broadcasts.push(payload);
      },
    },
  } as unknown as RegisterSocketHandlersDeps;

  registerSensorStatusHandlers(socket, { clientType: 'device', deviceId: 'ESP-462F82' }, deps);
  return { handlers, updates, broadcasts };
}

test('device:sensor-status persists and broadcasts ADXL fault state', async () => {
  const harness = createHarness();
  const handler = harness.handlers.get('device:sensor-status');
  assert.ok(handler);

  await handler({
    deviceId: 'ESP-462F82',
    sensor: 'adxl345',
    status: 'fault',
    reason: 'i2c_read_error',
    captureTimeoutCount: 0,
    i2cReadErrorCount: 1,
  });

  assert.deepEqual(harness.updates, [{
    status: 'fault',
    reason: 'i2c_read_error',
    captureTimeoutCount: 0,
    i2cReadErrorCount: 1,
  }]);
  assert.deepEqual(harness.broadcasts, [{
    deviceId: 'ESP-462F82',
    sensor: 'adxl345',
    status: 'fault',
    reason: 'i2c_read_error',
    captureTimeoutCount: 0,
    i2cReadErrorCount: 1,
    updatedAt: '2026-07-17T00:00:00.000Z',
  }]);
});

test('device:sensor-status rejects a reason outside fault status', async () => {
  const harness = createHarness();
  const handler = harness.handlers.get('device:sensor-status');
  assert.ok(handler);

  await handler({
    deviceId: 'ESP-462F82',
    sensor: 'adxl345',
    status: 'ok',
    reason: 'i2c_read_error',
  });

  assert.equal(harness.updates.length, 0);
  assert.equal(harness.broadcasts.length, 0);
});
