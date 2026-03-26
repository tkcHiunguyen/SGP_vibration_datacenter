import type { CommandType, DeviceCommand } from '../../shared/types.js';
import { DeviceService } from '../device/device.service.js';
import type { CommandRepository } from './command.repository.js';

export class CommandService {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly repository: CommandRepository,
    private readonly commandTimeoutMs = 10_000,
  ) {}

  private createTimeoutAt(now: Date): string {
    return new Date(now.getTime() + this.commandTimeoutMs).toISOString();
  }

  create(deviceId: string, type: CommandType, payload: Record<string, unknown> = {}): DeviceCommand | null {
    if (!this.deviceService.isConnected(deviceId)) {
      return null;
    }

    const now = new Date();
    const command: DeviceCommand = {
      commandId: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      sentAt: now.toISOString(),
    };

    this.repository.save({
      ...command,
      deviceId,
      status: 'sent',
      timeoutAt: this.createTimeoutAt(now),
      statusUpdatedAt: now.toISOString(),
    });

    return command;
  }

  acknowledge(commandId: string, deviceId: string): boolean {
    const found = this.repository.get(commandId);
    if (!found) {
      return false;
    }
    if (found.deviceId !== deviceId || found.status !== 'sent') {
      return false;
    }

    const nowIso = new Date().toISOString();
    this.repository.update({
      ...found,
      status: 'acked',
      ackedAt: nowIso,
      statusUpdatedAt: nowIso,
    });
    return true;
  }

  processTimeouts(nowIso = new Date().toISOString()): number {
    const candidates = this.repository.listTimedOutCandidates(nowIso);
    if (!candidates.length) {
      return 0;
    }

    for (const record of candidates) {
      this.repository.update({
        ...record,
        status: 'timeout',
        timeoutedAt: nowIso,
        statusUpdatedAt: nowIso,
      });
    }
    return candidates.length;
  }

  listRecent(limit = 100) {
    return this.repository.list(limit);
  }
}
