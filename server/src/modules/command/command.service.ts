import type { CommandType, DeviceCommand, DeviceCommandAck } from '../../shared/types.js';
import { DeviceService } from '../device/device.service.js';
import type { CommandRepository } from './command.repository.js';

export class CommandService {
  constructor(
    private readonly deviceService: DeviceService,
    private readonly repository: CommandRepository,
    private readonly commandTimeoutMs = 10_000,
  ) {}

  private resolveTimeoutMs(type: CommandType): number {
    if (type === 'ota' || type === 'ota_from_url') {
      return Math.max(this.commandTimeoutMs, 5 * 60_000);
    }
    return this.commandTimeoutMs;
  }

  private createTimeoutAt(now: Date, type: CommandType): string {
    return new Date(now.getTime() + this.resolveTimeoutMs(type)).toISOString();
  }

  private normalizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
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
      timeoutAt: this.createTimeoutAt(now, type),
      statusUpdatedAt: now.toISOString(),
    });

    return command;
  }

  acknowledge(
    commandId: string,
    deviceId: string,
    ack?: {
      status?: string;
      detail?: string;
      uuid?: string;
      firmwareVersion?: string;
      raw?: Record<string, unknown>;
      receivedAt?: string;
    },
  ): boolean {
    const found = this.repository.get(commandId);
    if (!found) {
      return false;
    }
    if (found.deviceId !== deviceId) {
      return false;
    }
    if (found.status === 'timeout') {
      return false;
    }

    const nowIso =
      this.normalizeOptionalText(ack?.receivedAt) ??
      new Date().toISOString();
    const ackStatus = this.normalizeOptionalText(ack?.status);
    const ackDetail = this.normalizeOptionalText(ack?.detail);
    const ackDeviceUuid = this.normalizeOptionalText(ack?.uuid);
    const ackFirmwareVersion = this.normalizeOptionalText(ack?.firmwareVersion);
    const ackHistory = Array.isArray(found.ackHistory) ? [...found.ackHistory] : [];
    const ackEvent: DeviceCommandAck = {
      commandId,
      deviceId,
      receivedAt: nowIso,
      status: ackStatus,
      detail: ackDetail,
      uuid: ackDeviceUuid,
      firmwareVersion: ackFirmwareVersion,
      raw: ack?.raw ? { ...ack.raw } : undefined,
    };
    ackHistory.push(ackEvent);

    this.repository.update({
      ...found,
      status: 'acked',
      ackedAt: found.ackedAt ?? nowIso,
      statusUpdatedAt: nowIso,
      ackStatus,
      ackDetail,
      ackDeviceUuid,
      ackFirmwareVersion,
      ackHistory: ackHistory.slice(-50),
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

  get(commandId: string) {
    return this.repository.get(commandId);
  }

  lookup(commandIds: string[]) {
    const unique = Array.from(new Set(commandIds.map((value) => value.trim()).filter(Boolean)));
    return unique
      .map((commandId) => this.repository.get(commandId))
      .filter((record): record is NonNullable<ReturnType<CommandRepository['get']>> => Boolean(record));
  }
}
