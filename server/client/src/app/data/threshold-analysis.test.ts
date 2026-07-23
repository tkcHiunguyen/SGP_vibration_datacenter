import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeviceThresholdUpdate, parseThresholdAnalysisJob, updateSensorThresholds } from './threshold-analysis';
import type { Sensor } from './sensors';

test('parses analysis results including missing metrics', () => {
  const job = parseThresholdAnalysisJob({
    jobId: 'job-1', status: 'completed', stage: 'done', progress: 100, days: 30,
    devices: {}, events: [], createdAt: 'now', updatedAt: 'now',
    results: [
      { deviceId: 'ESP-1', metric: 'arms', metricGroup: 'ARMS', status: 'ok', suggestedThreshold: 3.7, densityFrom: 1, densityTo: 4, densityBins: [70, 20, 10], filterWindowSize: 3 },
      { deviceId: 'ESP-1', metric: 'drms', metricGroup: 'DRMS', status: 'no_data' },
    ],
  });
  assert.equal(job?.results[0]?.suggestedThreshold, 3.7);
  assert.deepEqual(job?.results[0]?.densityBins, [70, 20, 10]);
  assert.equal(job?.results[0]?.filterWindowSize, 3);
  assert.equal(job?.results[1]?.status, 'no_data');
});

test('builds a partial threshold update from valid suggestions only', () => {
  const job = parseThresholdAnalysisJob({
    jobId: 'job-1', status: 'completed', stage: 'done', progress: 100, days: 30,
    devices: {}, events: [], createdAt: 'now', updatedAt: 'now',
    results: [
      { deviceId: 'ESP-1', metric: 'temperature', status: 'ok', suggestedThreshold: 62 },
      { deviceId: 'ESP-1', metric: 'arms', status: 'ok', suggestedThreshold: 3.7 },
      { deviceId: 'ESP-1', metric: 'vrms', status: 'error', suggestedThreshold: 12.75 },
      { deviceId: 'ESP-1', metric: 'drms', status: 'ok', suggestedThreshold: -1 },
    ],
  });
  assert.deepEqual(buildDeviceThresholdUpdate(job?.results ?? []), {
    temperatureSetpoint: 62,
    accelerationSetpoint: 3.7,
  });
});

test('updates sensor threshold state without replacing unrelated device fields', () => {
  const sensor = {
    id: 'ESP-1', name: 'TopGear', zone: '--', zoneCode: '', site: '--', uuid: 'uuid', status: 'normal', online: true,
    lastUpdated: 0, model: 'N/A', firmwareVersion: '1', firmware: '1', ipAddress: 'N/A', accelerationSetpoint: 10,
    velocitySetpoint: 10, displacementSetpoint: 10, temperatureSetpoint: 10, installDate: '--', samplingRate: '1 kHz',
    connectedAt: '--', lastHeartbeatAt: '--', signal: '--', uptime: '--', vibration1h: [], vibration5h: [],
  } satisfies Sensor;
  const updated = updateSensorThresholds(sensor, { accelerationSetpoint: 3.7, temperatureSetpoint: 62 });
  assert.equal(updated.name, 'TopGear');
  assert.equal(updated.accelerationSetpoint, 3.7);
  assert.equal(updated.temperatureSetpoint, 62);
  assert.equal(updated.velocitySetpoint, 10);
});
