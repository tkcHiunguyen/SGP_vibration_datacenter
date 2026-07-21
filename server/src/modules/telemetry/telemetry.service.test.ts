import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeviceService } from '../device/device.service.js';
import type { TelemetryMessage } from '../../shared/types.js';
import type { TelemetryRepository } from './telemetry.repository.js';
import { TelemetryService } from './telemetry.service.js';

class FakeTelemetryRepository implements TelemetryRepository {
  last: TelemetryMessage | null = null;

  setLast(message: TelemetryMessage): void {
    this.last = message;
  }

  getLast(): TelemetryMessage | null {
    return this.last;
  }

  async listHistory() { return { items: [], totalMatched: 0, truncated: false }; }
  async listAvailableDays() { return []; }
  async summarizeDevice() { return { total: 0, estimatedBytes: 0 }; }
  async exportHistory() { return []; }
  async countArchive() { return 0; }
  async *exportHistoryBatches() { yield []; }
  async importHistory() { return { inserted: 0, updated: 0, skipped: 0 }; }
  async importHistoryBatch() { return { inserted: 0, updated: 0, skipped: 0 }; }
  async rebuildHourlySummaries() {}
  async applyRetention() { return null; }
}

function createService(): TelemetryService {
  const deviceService = { heartbeat: () => null } as unknown as DeviceService;
  return new TelemetryService(new FakeTelemetryRepository(), deviceService);
}

test('normal telemetry preserves ADXL metrics and infers vibration availability for legacy payloads', () => {
  const message = createService().ingest('ESP-OK', {
    messageId: 'message-ok',
    temperature: 31.4,
    adxlStatus: 'ok',
    telemetryUuid: 'telemetry-ok',
    ax: 0.12,
    ay: 0.18,
    az: 0.09,
  });

  assert.equal(message.payload.messageId, 'message-ok');
  assert.equal(message.payload.temperatureAvailable, true);
  assert.equal(message.payload.vibrationAvailable, true);
  assert.equal(message.payload.adxlStatus, 'ok');
  assert.equal(message.payload.telemetryUuid, 'telemetry-ok');
  assert.equal(message.payload.ax, 0.12);
});

test('partial ADXL-fault telemetry keeps temperature and removes vibration data before broadcast', () => {
  const message = createService().ingest('ESP-PARTIAL', {
    messageId: 'message-partial',
    temperature: 31.4,
    temperatureAvailable: true,
    vibrationAvailable: false,
    adxlStatus: 'fault',
    adxlFaultReason: 'i2c_read_error',
    telemetryUuid: 'must-not-be-reused',
    ax: 0.12,
    ay: 0.18,
    az: 0.09,
  });

  assert.equal(message.payload.temperature, 31.4);
  assert.equal(message.payload.vibrationAvailable, false);
  assert.equal(message.payload.adxlStatus, 'fault');
  assert.equal(message.payload.adxlFaultReason, 'i2c_read_error');
  assert.equal(message.payload.ax, undefined);
  assert.equal(message.payload.ay, undefined);
  assert.equal(message.payload.az, undefined);
  assert.equal(message.payload.telemetryUuid, undefined);
});

test('telemetry rejects an ADXL fault without its required reason', () => {
  assert.throws(
    () => createService().ingest('ESP-INVALID', { adxlStatus: 'fault', vibrationAvailable: false }),
    /adxlFaultReason/,
  );
});
