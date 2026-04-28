import type { CommandRepository } from './command.repository.js';
import type { CommandRecord } from '../../shared/types.js';

export class InMemoryCommandRepository implements CommandRepository {
  private readonly records = new Map<string, CommandRecord>();

  async save(record: CommandRecord): Promise<void> {
    this.records.set(record.commandId, record);
  }

  get(commandId: string): CommandRecord | null {
    return this.records.get(commandId) || null;
  }

  list(limit = 100): CommandRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  async update(record: CommandRecord): Promise<void> {
    this.records.set(record.commandId, record);
  }

  async deleteByDeviceId(deviceId: string): Promise<number> {
    let deleted = 0;
    for (const [commandId, record] of this.records.entries()) {
      if (record.deviceId !== deviceId) {
        continue;
      }
      this.records.delete(commandId);
      deleted += 1;
    }
    return deleted;
  }

  listTimedOutCandidates(nowIso: string): CommandRecord[] {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) {
      return [];
    }
    return [...this.records.values()].filter((record) => {
      if (record.status !== 'sent') {
        return false;
      }
      const timeout = Date.parse(record.timeoutAt);
      return Number.isFinite(timeout) && timeout <= now;
    });
  }
}
