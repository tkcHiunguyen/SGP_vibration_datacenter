import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceService } from '../device/device.service.js';
import { InMemoryDeviceRepository } from '../device/in-memory-device.repository.js';
import type { CommandRepository } from './command.repository.js';
import { CommandService } from './command.service.js';
import type { CommandRecord } from '../../shared/types.js';

class DurableFakeCommandRepository implements CommandRepository {
  private readonly records = new Map<string, CommandRecord>();
  failNextSave = false;
  failNextUpdate = false;

  save(record: CommandRecord): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      return this.rejectWithoutUnhandledWarning();
    }
    this.records.set(record.commandId, record);
    return Promise.resolve();
  }

  get(commandId: string): CommandRecord | null {
    return this.records.get(commandId) ?? null;
  }

  list(limit = 100): CommandRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  update(record: CommandRecord): Promise<void> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return this.rejectWithoutUnhandledWarning();
    }
    this.records.set(record.commandId, record);
    return Promise.resolve();
  }

  deleteByDeviceId(deviceId: string): Promise<number> {
    let deleted = 0;
    for (const [commandId, record] of this.records.entries()) {
      if (record.deviceId === deviceId) {
        this.records.delete(commandId);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }

  listTimedOutCandidates(nowIso: string): CommandRecord[] {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) {
      return [];
    }
    return [...this.records.values()].filter((record) => {
      const timeout = Date.parse(record.timeoutAt);
      return record.status === 'sent' && Number.isFinite(timeout) && timeout <= now;
    });
  }

  seed(record: CommandRecord): void {
    this.records.set(record.commandId, record);
  }

  private rejectWithoutUnhandledWarning(): Promise<void> {
    const rejection = Promise.reject(new Error('persist_fail'));
    rejection.catch(() => undefined);
    return rejection;
  }
}

async function createConnectedDeviceService(deviceId: string): Promise<DeviceService> {
  const deviceRepository = await InMemoryDeviceRepository.create(null);
  const deviceService = new DeviceService(deviceRepository);
  deviceService.connect(deviceId, 'socket-1');
  return deviceService;
}

test('create rejects and does not acknowledge success when command persistence fails', async () => {
  const deviceId = 'ESP-CMD-001';
  const deviceService = await createConnectedDeviceService(deviceId);
  const repository = new DurableFakeCommandRepository();
  const service = new CommandService(deviceService, repository);
  repository.failNextSave = true;

  await assert.rejects(
    async () => service.create(deviceId, 'capture', { durationMs: 1000 }),
    /persist_fail/,
  );

  assert.equal(repository.list().length, 0);
});

test('acknowledge rejects and keeps command sent when command persistence fails', async () => {
  const deviceId = 'ESP-CMD-002';
  const deviceService = await createConnectedDeviceService(deviceId);
  const repository = new DurableFakeCommandRepository();
  const service = new CommandService(deviceService, repository);
  repository.seed({
    commandId: 'cmd-1',
    deviceId,
    type: 'capture',
    payload: {},
    sentAt: '2026-04-28T00:00:00.000Z',
    status: 'sent',
    timeoutAt: '2026-04-28T00:01:00.000Z',
    statusUpdatedAt: '2026-04-28T00:00:00.000Z',
  });
  repository.failNextUpdate = true;

  await assert.rejects(
    async () => service.acknowledge('cmd-1', deviceId, { status: 'ok' }),
    /persist_fail/,
  );

  assert.equal(repository.get('cmd-1')?.status, 'sent');
});
