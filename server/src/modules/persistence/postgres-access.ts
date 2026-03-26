import { Pool } from 'pg';
import type { PostgresConnectionSettings } from './postgres-env.js';
import { resolvePostgresConnectionSettings } from './postgres-env.js';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema.js';

type QueryParams = unknown[];

export class PostgresAccess {
  private readonly pool: Pool;
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly config: PostgresConnectionSettings,
    private readonly autoInit = process.env.DB_AUTO_INIT !== 'false',
  ) {
    this.pool = new Pool(config);
  }

  async ensureReady(): Promise<void> {
    if (this.closed) {
      throw new Error('postgres_access_closed');
    }
    if (!this.readyPromise) {
      this.readyPromise = this.initialize();
    }
    return this.readyPromise;
  }

  async query<T extends Record<string, unknown>>(sql: string, params: QueryParams = []): Promise<T[]> {
    await this.ensureReady();
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async execute(sql: string, params: QueryParams = []): Promise<number> {
    await this.ensureReady();
    const result = await this.pool.query(sql, params);
    return result.rowCount ?? 0;
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
    await this.pool.query(POSTGRES_SCHEMA_SQL);
  }
}

let sharedAccess: PostgresAccess | null | undefined;

export function getSharedPostgresAccess(): PostgresAccess | null {
  if (sharedAccess !== undefined) {
    return sharedAccess;
  }

  const config = resolvePostgresConnectionSettings();
  if (!config) {
    sharedAccess = null;
    return null;
  }

  sharedAccess = new PostgresAccess(config);
  return sharedAccess;
}

export function isPostgresAccessEnabled(): boolean {
  return Boolean(getSharedPostgresAccess());
}
