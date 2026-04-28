import type { CommandRecord } from '../../shared/types.js';

export interface CommandRepository {
  save(record: CommandRecord): Promise<void>;
  get(commandId: string): CommandRecord | null;
  list(limit?: number): CommandRecord[];
  update(record: CommandRecord): Promise<void>;
  deleteByDeviceId(deviceId: string): Promise<number>;
  listTimedOutCandidates(nowIso: string): CommandRecord[];
}
