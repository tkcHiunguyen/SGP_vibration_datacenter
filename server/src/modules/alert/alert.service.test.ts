import assert from 'node:assert/strict';
import test from 'node:test';

import type { TelemetryMessage } from '../../shared/types.js';
import {
  AlertService,
  DEVICE_ACCELERATION_RULE_ID,
  DEVICE_DISPLACEMENT_RULE_ID,
  DEVICE_TEMPERATURE_RULE_ID,
  DEVICE_VIBRATION_RULE_ID,
} from './alert.service.js';
import { InMemoryAlertRepository } from './in-memory-alert.repository.js';

function telemetry(
  deviceId: string,
  payload: TelemetryMessage['payload'],
  receivedAt: string,
): TelemetryMessage {
  return { deviceId, receivedAt, payload };
}

test('evaluates independent A, V, D and temperature setpoints per device', async () => {
  const repository = await InMemoryAlertRepository.create(null);
  const service = new AlertService(repository, () => ({
    acceleration: 2,
    velocity: 5,
    displacement: 0.3,
    temperature: 40,
  }));

  assert.deepEqual(
    new Set(service.listRules().map((rule) => rule.ruleId)),
    new Set([
      DEVICE_ACCELERATION_RULE_ID,
      DEVICE_VIBRATION_RULE_ID,
      DEVICE_DISPLACEMENT_RULE_ID,
      DEVICE_TEMPERATURE_RULE_ID,
    ]),
  );

  const triggered = service.evaluate(telemetry('ESP-A', {
    ax: -3,
    ay: 1,
    az: 2,
    vrms_x_mms: 4,
    vrms_y_mms: 6,
    vrms_z_mms: 5,
    drms_x_um: 200,
    drms_y_um: 400,
    drms_z_um: 300,
    temperature: 41,
  }, '2026-07-22T00:00:01.000Z'));

  assert.deepEqual(
    Object.fromEntries(triggered.map((alert) => [alert.metric, [alert.triggerValue, alert.threshold]])),
    {
      acceleration: [3, 2],
      velocity: [6, 5],
      displacement: [0.4, 0.3],
      temperature: [41, 40],
    },
  );
  assert.equal(service.countActiveAlerts(), 4);

  const resolved = service.evaluate(telemetry('ESP-A', {
    ax: 1,
    ay: 2,
    az: -1,
    vrms_x_mms: 4,
    vrms_y_mms: 5,
    vrms_z_mms: 3,
    drms_x_um: 100,
    drms_y_um: 300,
    drms_z_um: 200,
    temperature: 40,
  }, '2026-07-22T00:00:02.000Z'));

  assert.equal(resolved.length, 4);
  assert.equal(resolved.every((alert) => alert.status === 'resolved'), true);
  assert.equal(service.countActiveAlerts(), 0);
});

test('uses legacy vibration only when VRMS axes are unavailable', async () => {
  const repository = await InMemoryAlertRepository.create(null);
  const service = new AlertService(repository, () => ({
    acceleration: 10,
    velocity: 5,
    displacement: 10,
    temperature: 10,
  }));

  const fallback = service.evaluate(telemetry(
    'ESP-V',
    { vibration: 6 },
    '2026-07-22T00:00:00.000Z',
  ));
  assert.equal(fallback[0]?.metric, 'velocity');
  assert.equal(fallback[0]?.triggerValue, 6);

  const resolved = service.evaluate(telemetry(
    'ESP-V',
    { vibration: 9, vrms_x_mms: 4, vrms_y_mms: 3, vrms_z_mms: 2 },
    '2026-07-22T00:00:01.000Z',
  ));
  assert.equal(resolved[0]?.status, 'resolved');
  assert.equal(resolved[0]?.lastValue, 4);
});
