import { randomUUID } from 'node:crypto';

import type { MySqlAccess } from '../persistence/mysql-access.js';

type ServerRuntimeRow = {
  id: number | string;
  started_at: string | Date;
  last_heartbeat_at: string | Date | null;
  stopped_at: string | Date | null;
};

type ServerRuntimeSnapshot = {
  runId: string;
  startedAt: string;
  previousShutdownAt?: string;
};

function toIsoTimestamp(value: string | Date | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function laterIso(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}

export class ServerRuntimeTracker {
  private readonly runId = randomUUID();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatRunning = false;
  private startedAt: string | null = null;

  constructor(
    private readonly mysql: MySqlAccess | null,
    private readonly serviceName: string,
    private readonly heartbeatMs: number,
  ) {}

  async start(): Promise<ServerRuntimeSnapshot | null> {
    if (!this.mysql) {
      return null;
    }

    const startedAt = new Date().toISOString();
    this.startedAt = startedAt;
    const previousShutdownAt = await this.closePreviousRuns(startedAt);
    await this.mysql.execute(
      `
        INSERT INTO server_runtime_history (
          run_id, service_name, started_at, last_heartbeat_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [this.runId, this.serviceName, startedAt, startedAt, startedAt, startedAt],
    );

    this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.heartbeatMs);
    this.heartbeatTimer.unref();

    return { runId: this.runId, startedAt, previousShutdownAt };
  }

  async heartbeat(): Promise<void> {
    if (!this.mysql || this.heartbeatRunning || !this.startedAt) {
      return;
    }

    this.heartbeatRunning = true;
    try {
      const now = new Date().toISOString();
      await this.mysql.execute(
        `
          UPDATE server_runtime_history
          SET last_heartbeat_at = ?, updated_at = ?
          WHERE run_id = ? AND stopped_at IS NULL
        `,
        [now, now, this.runId],
      );
    } finally {
      this.heartbeatRunning = false;
    }
  }

  async stop(reason: string): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (!this.mysql || !this.startedAt) {
      return;
    }

    const stoppedAt = new Date().toISOString();
    await this.mysql.execute(
      `
        UPDATE server_runtime_history
        SET last_heartbeat_at = ?, stopped_at = ?, stop_reason = ?, updated_at = ?
        WHERE run_id = ? AND stopped_at IS NULL
      `,
      [stoppedAt, stoppedAt, reason, stoppedAt, this.runId],
    );
  }

  private async closePreviousRuns(startedAt: string): Promise<string | undefined> {
    if (!this.mysql) {
      return undefined;
    }

    let previousShutdownAt: string | undefined;
    const openRows = await this.mysql.query<ServerRuntimeRow>(
      `
        SELECT id, started_at, last_heartbeat_at, stopped_at
        FROM server_runtime_history
        WHERE service_name = ? AND stopped_at IS NULL
        ORDER BY id ASC
      `,
      [this.serviceName],
    );

    for (const row of openRows) {
      const stoppedAt = toIsoTimestamp(row.last_heartbeat_at) ?? toIsoTimestamp(row.started_at) ?? startedAt;
      previousShutdownAt = laterIso(previousShutdownAt, stoppedAt);
      await this.mysql.execute(
        `
          UPDATE server_runtime_history
          SET stopped_at = ?, stop_reason = ?, updated_at = ?
          WHERE id = ? AND stopped_at IS NULL
        `,
        [stoppedAt, 'unclean_shutdown', stoppedAt, row.id],
      );
    }

    if (previousShutdownAt) {
      return previousShutdownAt;
    }

    const latestRows = await this.mysql.query<ServerRuntimeRow>(
      `
        SELECT id, started_at, last_heartbeat_at, stopped_at
        FROM server_runtime_history
        WHERE service_name = ? AND stopped_at IS NOT NULL
        ORDER BY stopped_at DESC, id DESC
        LIMIT 1
      `,
      [this.serviceName],
    );
    return toIsoTimestamp(latestRows[0]?.stopped_at);
  }
}
