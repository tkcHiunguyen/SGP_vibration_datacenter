import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';
import type { DeviceRemovalResult, DeviceRepository } from './device.repository.js';
import { DeviceService } from './device.service.js';

class FakeDeviceRepository implements DeviceRepository {
  readonly metadata = new Map<string, DeviceMetadata>();
  readonly sessions = new Map<string, DeviceSession>();
  failNextMetadataUpsert = false;

  async upsertMetadata(metadata: DeviceMetadata): Promise<void> {
    if (this.failNextMetadataUpsert) {
      this.failNextMetadataUpsert = false;
      throw new Error('persist_fail');
    }
    this.metadata.set(metadata.deviceId, metadata);
  }

  async removeMetadata(deviceId: string): Promise<DeviceRemovalResult | null> {
    const existing = this.metadata.get(deviceId) ?? null;
    if (!existing) {
      return null;
    }
    this.metadata.delete(deviceId);
    this.sessions.delete(deviceId);
    return {
      metadata: existing,
      telemetryDeleted: 0,
    };
  }

  async clearTelemetryData(deviceId: string): Promise<number> {
    return this.metadata.has(deviceId) ? 0 : 0;
  }

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.metadata.get(deviceId) ?? null;
  }

  listMetadata(): DeviceMetadata[] {
    return [...this.metadata.values()];
  }

  upsertSession(session: DeviceSession): void {
    this.sessions.set(session.deviceId, session);
  }

  getSession(deviceId: string): DeviceSession | null {
    return this.sessions.get(deviceId) ?? null;
  }

  listSessions(): DeviceSession[] {
    return [...this.sessions.values()];
  }

  removeIfSocketMatches(deviceId: string, socketId: string): boolean {
    const current = this.sessions.get(deviceId);
    if (!current || current.socketId !== socketId) {
      return false;
    }
    this.sessions.delete(deviceId);
    return true;
  }

  touch(deviceId: string, isoTime: string, heartbeat?: DeviceHeartbeat): DeviceSession | null {
    const current = this.sessions.get(deviceId);
    if (!current) {
      return null;
    }
    const next: DeviceSession = {
      ...current,
      lastHeartbeatAt: isoTime,
      heartbeat: heartbeat ? { ...(current.heartbeat ?? {}), ...heartbeat } : current.heartbeat,
    };
    this.sessions.set(deviceId, next);
    return next;
  }

  isConnected(deviceId: string): boolean {
    return this.sessions.has(deviceId);
  }

  countConnected(): number {
    return this.sessions.size;
  }
}

test('registerStrict persists metadata and returns saved device', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  const created = await service.registerStrict({
    deviceId: 'ESP-001',
    name: 'Pump 01',
    zone: 'ROLL_OUT',
    firmwareVersion: '1.0.6',
  });

  assert.equal(created.deviceId, 'ESP-001');
  assert.equal(created.name, 'Pump 01');
  assert.equal(created.zone, 'ROLL_OUT');
  assert.equal(repository.getMetadata('ESP-001')?.firmwareVersion, '1.0.6');
});

test('updateStrict bubbles persistence failures instead of reporting fake success', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({
    deviceId: 'ESP-002',
    name: 'Old Name',
    zone: 'ZONE_A',
  });

  repository.failNextMetadataUpsert = true;
  await assert.rejects(
    () =>
      service.updateStrict('ESP-002', {
        name: 'New Name',
      }),
    /persist_fail/,
  );

  // State should stay unchanged because persistence write failed.
  assert.equal(repository.getMetadata('ESP-002')?.name, 'Old Name');
});

test('clearZoneAssignments removes zone for all devices in target zone', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({ deviceId: 'ESP-A', name: 'A', zone: 'ZONE_X' });
  await service.registerStrict({ deviceId: 'ESP-B', name: 'B', zone: 'ZONE_X' });
  await service.registerStrict({ deviceId: 'ESP-C', name: 'C', zone: 'ZONE_Y' });

  const result = await service.clearZoneAssignments('ZONE_X');

  assert.equal(result.updated, 2);
  assert.deepEqual(result.deviceIds.sort(), ['ESP-A', 'ESP-B']);
  assert.equal(repository.getMetadata('ESP-A')?.zone, undefined);
  assert.equal(repository.getMetadata('ESP-B')?.zone, undefined);
  assert.equal(repository.getMetadata('ESP-C')?.zone, 'ZONE_Y');
});

test('deleteStrict archives/removes device metadata from active inventory', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({ deviceId: 'ESP-DEL', name: 'To delete', zone: 'ZONE_Z' });
  assert.equal(service.list().length, 1);

  const deleted = await service.deleteStrict('ESP-DEL');
  assert.ok(deleted);
  assert.equal(deleted?.metadata.deviceId, 'ESP-DEL');
  assert.equal(deleted?.telemetryDeleted, 0);
  assert.equal(service.list().length, 0);
  assert.equal(repository.getMetadata('ESP-DEL'), null);
});

test('clearTelemetryDataStrict clears telemetry only for existing device', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({ deviceId: 'ESP-CLEAR', name: 'Clear target', zone: 'ZONE_A' });

  const deletedCount = await service.clearTelemetryDataStrict('ESP-CLEAR');
  assert.equal(deletedCount, 0);

  const missingDeviceResult = await service.clearTelemetryDataStrict('ESP-NOT-FOUND');
  assert.equal(missingDeviceResult, null);
});
