import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';
import type { MySqlAccess } from '../persistence/mysql-access.js';
import type { DeviceDeletionImpact, DeviceRemovalResult, DeviceRepository } from './device.repository.js';
import { DeviceService } from './device.service.js';
import { InMemoryDeviceRepository } from './in-memory-device.repository.js';

class FakeDeviceRepository implements DeviceRepository {
  readonly metadata = new Map<string, DeviceMetadata>();
  readonly sessions = new Map<string, DeviceSession>();
  failNextMetadataUpsert = false;
  impactOverrides = new Map<string, Partial<DeviceDeletionImpact>>();

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
    const impact = await this.inspectRemoval(deviceId);
    this.metadata.delete(deviceId);
    this.sessions.delete(deviceId);
    return {
      metadata: existing,
      impact: impact ?? this.createDefaultImpact(deviceId, existing),
    };
  }

  async inspectRemoval(deviceId: string): Promise<DeviceDeletionImpact | null> {
    const existing = this.metadata.get(deviceId) ?? null;
    if (!existing) {
      return null;
    }
    return this.createDefaultImpact(deviceId, existing);
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

  private createDefaultImpact(deviceId: string, metadata: DeviceMetadata): DeviceDeletionImpact {
    const override = this.impactOverrides.get(deviceId) ?? {};
    const base: DeviceDeletionImpact = {
      deviceId,
      deviceName: metadata.name,
      deviceRows: 1,
      telemetryRows: 0,
      spectrumFrames: 0,
      spectrumBytes: 0,
      socketSessions: this.sessions.has(deviceId) ? 1 : 0,
      commandRows: 0,
      alertRows: 0,
      auditLogRows: 0,
      totalRows: 1 + (this.sessions.has(deviceId) ? 1 : 0),
    };
    const next = { ...base, ...override };
    return {
      ...next,
      totalRows:
        next.deviceRows +
        next.telemetryRows +
        next.spectrumFrames +
        next.socketSessions +
        next.commandRows +
        next.alertRows +
        next.auditLogRows,
    };
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

test('repository loads device rows without legacy archive or sensor version columns', async () => {
  const mysql = {
    async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
      if (!sql.includes('FROM devices')) {
        return [];
      }
      assert.equal(sql.includes('archived_at'), false);
      assert.equal(sql.includes('sensor_version'), false);
      const rows = [
        {
          device_id: 'ESP-ACTIVE',
          uuid: 'active-uuid',
          name: 'Active device',
          site: null,
          zone: null,
          firmware_version: null,
          notes: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          device_id: 'ESP-LEGACY',
          uuid: 'legacy-uuid',
          name: 'Legacy device',
          site: null,
          zone: null,
          firmware_version: null,
          notes: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-02T00:00:00.000Z',
        },
      ];
      return rows as unknown as T[];
    },
    async execute(): Promise<number> {
      return 0;
    },
  } as unknown as MySqlAccess;

  const repository = await InMemoryDeviceRepository.create(mysql);
  const service = new DeviceService(repository);

  assert.deepEqual(service.list().map((device) => device.deviceId), ['ESP-ACTIVE', 'ESP-LEGACY']);
  assert.equal(await service.inspectDeletionImpact('ESP-LEGACY') !== null, true);
});

test('inspectDeletionImpact reports related rows before hard delete', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({ deviceId: 'ESP-IMPACT', name: 'Impact target', zone: 'ZONE_Z' });
  repository.impactOverrides.set('ESP-IMPACT', {
    telemetryRows: 12,
    spectrumFrames: 3,
    commandRows: 2,
    alertRows: 1,
    auditLogRows: 4,
  });

  const impact = await service.inspectDeletionImpact('ESP-IMPACT');

  assert.ok(impact);
  assert.equal(impact?.deviceRows, 1);
  assert.equal(impact?.telemetryRows, 12);
  assert.equal(impact?.spectrumFrames, 3);
  assert.equal(impact?.commandRows, 2);
  assert.equal(impact?.alertRows, 1);
  assert.equal(impact?.auditLogRows, 4);
  assert.equal(impact?.totalRows, 23);
});

test('deleteStrict hard deletes device metadata and reports deleted impact', async () => {
  const repository = new FakeDeviceRepository();
  const service = new DeviceService(repository);

  await service.registerStrict({ deviceId: 'ESP-DEL', name: 'To delete', zone: 'ZONE_Z' });
  repository.impactOverrides.set('ESP-DEL', {
    telemetryRows: 7,
    commandRows: 2,
  });
  assert.equal(service.list().length, 1);

  const deleted = await service.deleteStrict('ESP-DEL');
  assert.ok(deleted);
  assert.equal(deleted?.metadata.deviceId, 'ESP-DEL');
  assert.equal(deleted?.impact.telemetryRows, 7);
  assert.equal(deleted?.impact.commandRows, 2);
  assert.equal(service.list().length, 0);
  assert.equal(repository.getMetadata('ESP-DEL'), null);
  assert.equal(await service.inspectDeletionImpact('ESP-DEL'), null);
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
