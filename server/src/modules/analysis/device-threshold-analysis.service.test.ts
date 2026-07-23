import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceService } from '../device/device.service.js';
import {
  analyzeThresholdSamples,
  buildAnalysisDeviceLabel,
  DeviceThresholdAnalysisService,
  extractThresholdMetrics,
  selectAnalysisDevices,
} from './device-threshold-analysis.service.js';

test('labels analysis devices by name and assignment without exposing ESP ids', () => {
  assert.equal(
    buildAnalysisDeviceLabel({ deviceId: 'ESP-1', metadata: { name: 'TopGear', site: 'Line 1', zone: 'Zone A' } }),
    'TopGear - Line 1 - Zone A',
  );
  assert.equal(
    buildAnalysisDeviceLabel({ deviceId: 'ESP-2', metadata: { name: 'TopGear' } }),
    'TopGear - Chưa gán',
  );
});

test('filters simulation devices and disambiguates duplicate labels', () => {
  const devices = [
    { deviceId: 'ESP-1', metadata: { name: 'Bearing', site: 'Line 1' } },
    { deviceId: 'ESP-2', metadata: { name: 'Bearing', site: 'Line 1' } },
    { deviceId: 'SIM-1', metadata: { name: 'Simulation' } },
  ];
  const selected = selectAnalysisDevices(devices, { days: 30, includeSim: false });
  assert.deepEqual(selected.map((device) => device.analysisLabel), ['Bearing - Line 1 #1', 'Bearing - Line 1 #2']);
});

test('maps raw telemetry to Temp, strongest A, preferred V and converted D', () => {
  assert.deepEqual(extractThresholdMetrics({
    temperature: 42,
    ax: -1,
    ay: 3,
    az: 2,
    vibration: 4.5,
    vrms_x_mms: 99,
    drms_x_um: 100,
    drms_y_um: -250,
  }), {
    temperature: 42,
    arms: 3,
    vrms: 4.5,
    drms: 0.25,
  });
});

test('sets the threshold ten percent above the highest-density value', () => {
  const samples = [10, 10, 100, 10, 10, 10, 100, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
  const result = analyzeThresholdSamples(samples, 0.5, true);
  assert.equal(result?.dataPoints, 20);
  assert.equal(result?.filterWindowSize, 3);
  assert.equal(result?.p95, 10);
  assert.equal(result?.p99, 10);
  assert.equal(result?.popularCenter, 10.25);
  assert.equal(result?.suggestedThreshold, 11.5);
  assert.equal(result?.densityBins?.length, 24);
  assert.equal(Math.round((result?.densityBins ?? []).reduce((sum, value) => sum + value, 0)), 100);
});

test('job consumes every raw telemetry batch without bucket sampling', async () => {
  const deviceService = {
    list: () => [{
      deviceId: 'ESP-1',
      metadata: {
        deviceId: 'ESP-1',
        name: 'Pump',
        vibrationSetpoint: 10,
        accelerationSetpoint: 10,
        displacementSetpoint: 10,
        temperatureSetpoint: 10,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }],
  } as unknown as DeviceService;
  let yieldedBatches = 0;
  const telemetry = {
    countArchive: async () => 3,
    exportHistoryBatches: async function* () {
      yieldedBatches += 1;
      yield [
        { deviceId: 'ESP-1', receivedAt: '2026-07-01T00:00:00.000Z', payload: { temperature: 10 } },
        { deviceId: 'ESP-1', receivedAt: '2026-07-01T00:00:01.000Z', payload: { temperature: 20 } },
      ];
      yieldedBatches += 1;
      yield [{ deviceId: 'ESP-1', receivedAt: '2026-07-01T00:00:02.000Z', payload: { temperature: 30 } }];
    },
  };
  const service = new DeviceThresholdAnalysisService(deviceService, telemetry);
  const started = service.start({ days: 7, includeSim: false });

  let completed = service.get(started.jobId);
  for (let attempt = 0; attempt < 50 && completed?.status !== 'completed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    completed = service.get(started.jobId);
  }

  assert.equal(completed?.status, 'completed');
  assert.equal(yieldedBatches, 2);
  assert.equal(completed?.devices['ESP-1']?.processedRows, 3);
  assert.equal(completed?.results.find((row) => row.metric === 'temperature')?.dataPoints, 3);
});
