import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';
import type { MySqlConnectionSettings } from './mysql-env.js';
import { resolveMySqlConnectionSettings } from './mysql-env.js';
import { MYSQL_SCHEMA_SQL } from './mysql-schema.js';

type QueryParams = Array<string | number | boolean | null | Date | Buffer>;

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function toMySqlDateTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return iso.slice(0, 23).replace('T', ' ');
}

function normalizeParams(params: QueryParams): QueryParams {
  return params.map((value) => {
    if (value === null) {
      return value;
    }

    if (value instanceof Date) {
      return toMySqlDateTime(value);
    }

    if (typeof value === 'string' && isIsoDateString(value)) {
      return toMySqlDateTime(value);
    }

    return value;
  });
}

export class MySqlAccess {
  private readonly pool: Pool;
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly config: MySqlConnectionSettings,
    private readonly autoInit = process.env.DB_AUTO_INIT !== 'false',
  ) {
    this.pool = createPool(config);
  }

  async ensureReady(): Promise<void> {
    if (this.closed) {
      throw new Error('mysql_access_closed');
    }
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    return this.readyPromise;
  }

  async query<T extends Record<string, unknown>>(sql: string, params: QueryParams = []): Promise<T[]> {
    await this.ensureReady();
    const normalized = normalizeParams(params);
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, normalized as never);
    return rows as unknown as T[];
  }

  async execute(sql: string, params: QueryParams = []): Promise<number> {
    await this.ensureReady();
    const normalized = normalizeParams(params);
    const [result] = await this.pool.execute(sql, normalized as never);
    if (typeof result === 'object' && result && 'affectedRows' in result) {
      const affectedRows = (result as { affectedRows?: number }).affectedRows;
      return affectedRows ?? 0;
    }
    return 0;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }

  private async initialize(): Promise<void> {
    if (!this.autoInit) {
      return;
    }
    await this.pool.query(MYSQL_SCHEMA_SQL);
  }
}

let sharedAccess: MySqlAccess | null | undefined;

export function getSharedMySqlAccess(): MySqlAccess | null {
  if (sharedAccess !== undefined) {
    return sharedAccess;
  }

  const config = resolveMySqlConnectionSettings();
  if (!config) {
    sharedAccess = null;
    return null;
  }

  sharedAccess = new MySqlAccess(config);
  return sharedAccess;
}

export function isMySqlAccessEnabled(): boolean {
  return Boolean(getSharedMySqlAccess());
}
