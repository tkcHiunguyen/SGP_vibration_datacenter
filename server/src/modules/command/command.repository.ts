import type { CommandRecord } from '../../shared/types.js';

export interface CommandRepository {
  save(record: CommandRecord): void;
  get(commandId: string): CommandRecord | null;
  list(limit?: number): CommandRecord[];
  update(record: CommandRecord): void;
  listTimedOutCandidates(nowIso: string): CommandRecord[];
}
