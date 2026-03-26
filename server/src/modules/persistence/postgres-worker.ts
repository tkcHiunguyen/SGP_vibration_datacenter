import { parentPort } from 'node:worker_threads';
import type { MessagePort } from 'node:worker_threads';
import { Pool } from 'pg';
import type { PostgresConnectionSettings } from './postgres-env.js';
import { POSTGRES_SCHEMA_SQL } from './postgres-schema.js';

type QueryRequest = {
  type: 'query';
  sql: string;
  params?: unknown[];
  signal: SharedArrayBuffer;
  reply: MessagePort;
};

type InitRequest = {
  type: 'init';
  signal: SharedArrayBuffer;
  reply: MessagePort;
  config: PostgresConnectionSettings;
};

type CloseRequest = {
  type: 'close';
  signal: SharedArrayBuffer;
  reply: MessagePort;
};

type DispatchRequest = {
  type: 'dispatch';
  sql: string;
  params?: unknown[];
};

type WorkerRequest = QueryRequest | InitRequest | CloseRequest | DispatchRequest;

type WorkerResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; stack?: string };

let pool: Pool | null = null;
let schemaReady = false;

function getPool(config?: PostgresConnectionSettings): Pool {
  if (!pool) {
    pool = new Pool(config);
  }

  return pool;
}

async function ensureSchema(config: PostgresConnectionSettings): Promise<void> {
  if (schemaReady) {
    return;
  }

  const currentPool = getPool(config);
  await currentPool.query(POSTGRES_SCHEMA_SQL);
  schemaReady = true;
}

function settle<T>(reply: MessagePort, signal: SharedArrayBuffer, response: WorkerResponse<T>): void {
  reply.postMessage(response);
  reply.close();
  const signalView = new Int32Array(signal);
  Atomics.store(signalView, 0, 1);
  Atomics.notify(signalView, 0);
}

async function handleRequest(message: WorkerRequest): Promise<void> {
  try {
    if (message.type === 'dispatch') {
      if (!pool) {
        throw new Error('Postgres pool is not initialized');
      }
      await pool.query(message.sql, message.params ?? []);
      return;
    }

    if (message.type === 'init') {
      await ensureSchema(message.config);
      settle(message.reply, message.signal, { ok: true, data: { ready: true } });
      return;
    }

    if (message.type === 'close') {
      if (pool) {
        await pool.end();
        pool = null;
        schemaReady = false;
      }
      settle(message.reply, message.signal, { ok: true, data: { closed: true } });
      return;
    }

    if (!pool) {
      throw new Error('Postgres pool is not initialized');
    }

    const result = await pool.query(message.sql, message.params ?? []);
    settle(message.reply, message.signal, {
      ok: true,
      data: {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
      },
    });
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    if (message.type === 'dispatch') {
      console.error('[postgres-worker] async dispatch failed:', resolvedError.message);
      return;
    }
    settle(message.reply, message.signal, {
      ok: false,
      error: resolvedError.message,
      stack: resolvedError.stack,
    });
  }
}

parentPort?.on('message', (message: WorkerRequest) => {
  void handleRequest(message);
});
