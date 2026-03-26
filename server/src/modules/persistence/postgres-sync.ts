import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { PostgresConnectionSettings } from './postgres-env.js';
import { resolvePostgresConnectionSettings } from './postgres-env.js';

type WorkerResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; stack?: string };

type WorkerRequest = {
  type: 'init' | 'query' | 'close';
  config?: PostgresConnectionSettings;
  sql?: string;
  params?: unknown[];
  signal: SharedArrayBuffer;
  reply: MessagePort;
};

type DispatchWorkerRequest = {
  type: 'dispatch';
  sql: string;
  params?: unknown[];
};

type QueryResult<T> = {
  rows: T[];
  rowCount: number;
};

class SyncPostgresClient {
  private worker: Worker | null = null;
  private initialized = false;
  private closed = false;

  constructor(private readonly config: PostgresConnectionSettings) {}

  get available(): boolean {
    return !this.closed && Boolean(this.config);
  }

  ensureSchema(): boolean {
    if (!this.available) {
      return false;
    }

    if (!this.worker) {
      this.worker = new Worker(new URL('./postgres-worker.js', import.meta.url), {
        type: 'module',
      } as unknown as WorkerOptions);
    }

    if (!this.initialized) {
      this.request<{ ready: boolean }>({
        type: 'init',
        config: this.config,
      });
      this.initialized = true;
    }

    return true;
  }

  query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const result = this.request<QueryResult<T>>({
      type: 'query',
      sql,
      params,
    });
    return result.rows;
  }

  execute(sql: string, params: unknown[] = []): number {
    return this.request<QueryResult<Record<string, unknown>>>({
      type: 'query',
      sql,
      params,
    }).rowCount;
  }

  executeAsync(sql: string, params: unknown[] = []): void {
    if (!this.ensureSchema() || !this.worker) {
      return;
    }

    this.worker.postMessage({
      type: 'dispatch',
      sql,
      params,
    } satisfies DispatchWorkerRequest);
  }

  close(): void {
    if (!this.worker || this.closed) {
      return;
    }

    this.request<{ closed: boolean }>({
      type: 'close',
    });
    void this.worker.terminate();
    this.worker = null;
    this.closed = true;
    this.initialized = false;
  }

  private request<T>(request: Omit<WorkerRequest, 'reply' | 'signal'>): T {
    if (!this.worker) {
      throw new Error('Postgres worker is not initialized');
    }

    const { port1, port2 } = new MessageChannel();
    const signal = new SharedArrayBuffer(4);
    const signalView = new Int32Array(signal);
    signalView[0] = 0;

    this.worker.postMessage(
      {
        ...request,
        reply: port2,
        signal,
      },
      [port2],
    );

    const waitResult = Atomics.wait(signalView, 0, 0, 30_000);
    if (waitResult === 'timed-out') {
      port1.close();
      throw new Error('Timed out waiting for Postgres worker response');
    }

    const received = receiveMessageOnPort(port1);
    port1.close();

    if (!received) {
      throw new Error('Postgres worker completed without a response');
    }

    const response = received.message as WorkerResponse<T>;
    if (!response.ok) {
      const error = new Error(response.error);
      if (response.stack) {
        error.stack = response.stack;
      }
      throw error;
    }

    return response.data;
  }
}

let sharedClient: SyncPostgresClient | null | undefined;

export function getSharedPostgresClient(): SyncPostgresClient | null {
  if (sharedClient !== undefined) {
    return sharedClient;
  }

  const config = resolvePostgresConnectionSettings();
  if (!config) {
    sharedClient = null;
    return null;
  }

  sharedClient = new SyncPostgresClient(config);
  return sharedClient;
}

export function isPostgresPersistenceEnabled(): boolean {
  return Boolean(getSharedPostgresClient());
}

export function generateDbId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
