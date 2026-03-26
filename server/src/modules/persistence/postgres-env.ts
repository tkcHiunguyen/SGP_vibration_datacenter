import type { PoolConfig } from 'pg';

export type PostgresConnectionSettings = PoolConfig;

function readBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'require'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function resolvePostgresConnectionSettings(
  env: NodeJS.ProcessEnv = process.env,
): PostgresConnectionSettings | null {
  const connectionString = env.DATABASE_URL ?? env.POSTGRES_URL ?? env.PGURL;
  const host = env.PGHOST ?? env.POSTGRES_HOST;
  const port = env.PGPORT ?? env.POSTGRES_PORT;
  const user = env.PGUSER ?? env.POSTGRES_USER;
  const password = env.PGPASSWORD ?? env.POSTGRES_PASSWORD;
  const database = env.PGDATABASE ?? env.POSTGRES_DB ?? env.POSTGRES_DATABASE;
  const ssl =
    readBoolean(env.PGSSLMODE) ??
    readBoolean(env.POSTGRES_SSL) ??
    readBoolean(env.POSTGRES_SSL_ENABLED);

  if (
    !connectionString &&
    !host &&
    !port &&
    !user &&
    !password &&
    !database &&
    ssl === undefined
  ) {
    return null;
  }

  const settings: PostgresConnectionSettings = {};
  if (connectionString) {
    settings.connectionString = connectionString;
  }
  if (host) {
    settings.host = host;
  }
  if (port) {
    settings.port = Number(port);
  }
  if (user) {
    settings.user = user;
  }
  if (password) {
    settings.password = password;
  }
  if (database) {
    settings.database = database;
  }
  if (ssl !== undefined) {
    settings.ssl = ssl;
  }

  return settings;
}
