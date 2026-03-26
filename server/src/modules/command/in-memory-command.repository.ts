import type { CommandRepository } from './command.repository.js';
import type { CommandRecord } from '../../shared/types.js';

export class InMemoryCommandRepository implements CommandRepository {
  private readonly records = new Map<string, CommandRecord>();

  save(record: CommandRecord): void {
    this.records.set(record.commandId, record);
  }

  get(commandId: string): CommandRecord | null {
    return this.records.get(commandId) || null;
  }

  list(limit = 100): CommandRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  update(record: CommandRecord): void {
    this.records.set(record.commandId, record);
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
