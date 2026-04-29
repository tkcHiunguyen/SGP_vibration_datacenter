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

type MySqlAccessCandidate = Pick<MySqlAccess, 'ensureReady' | 'close'>;

export type MySqlPersistenceStatus =
  | {
      mode: 'mysql';
      configured: true;
      ready: true;
    }
  | {
      mode: 'in-memory';
      configured: false;
      ready: false;
      reason: 'not_configured';
    }
  | {
      mode: 'in-memory';
      configured: true;
      ready: false;
      reason: 'unavailable';
      errorCode?: string;
    };

type MySqlStartupLogger = {
  warn: (bindings: Record<string, unknown>, message: string) => void;
};

type ResolveActiveMySqlAccessOptions<TAccess extends MySqlAccessCandidate> = {
  candidate?: TAccess | null;
  fallbackOnUnavailable?: boolean;
  logger?: MySqlStartupLogger;
};

type ActiveMySqlRuntime<TAccess extends MySqlAccessCandidate> = {
  access: TAccess | null;
  status: MySqlPersistenceStatus;
};

const MYSQL_UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_BAD_DB_ERROR',
]);

export function getMySqlErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isMySqlUnavailableError(error: unknown): boolean {
  const code = getMySqlErrorCode(error);
  return code ? MYSQL_UNAVAILABLE_ERROR_CODES.has(code) : false;
}

export async function resolveActiveMySqlAccess<TAccess extends MySqlAccessCandidate = MySqlAccess>({
  candidate,
  fallbackOnUnavailable = true,
  logger,
}: ResolveActiveMySqlAccessOptions<TAccess> = {}): Promise<ActiveMySqlRuntime<TAccess>> {
  const mysql = candidate === undefined ? (getSharedMySqlAccess() as TAccess | null) : candidate;

  if (!mysql) {
    return {
      access: null,
      status: {
        mode: 'in-memory',
        configured: false,
        ready: false,
        reason: 'not_configured',
      },
    };
  }

  try {
    await mysql.ensureReady();
    return {
      access: mysql,
      status: {
        mode: 'mysql',
        configured: true,
        ready: true,
      },
    };
  } catch (error) {
    if (!fallbackOnUnavailable || !isMySqlUnavailableError(error)) {
      throw error;
    }

    logger?.warn({ err: error }, 'MySQL is unavailable; falling back to in-memory persistence');
    await mysql.close().catch((closeError: unknown) => {
      logger?.warn({ err: closeError }, 'Failed to close unavailable MySQL pool');
    });

    return {
      access: null,
      status: {
        mode: 'in-memory',
        configured: true,
        ready: false,
        reason: 'unavailable',
        errorCode: getMySqlErrorCode(error),
      },
    };
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
