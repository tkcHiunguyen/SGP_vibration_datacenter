import type { PoolOptions } from 'mysql2/promise';

export type MySqlConnectionSettings = PoolOptions;

export function resolveMySqlConnectionSettings(
  env: NodeJS.ProcessEnv = process.env,
): MySqlConnectionSettings | null {
  const connectionString = env.MYSQL_URL ?? env.DATABASE_URL;
  const host = env.MYSQL_HOST;
  const port = env.MYSQL_PORT;
  const user = env.MYSQL_USER;
  const password = env.MYSQL_PASSWORD;
  const database = env.MYSQL_DATABASE;

  if (!connectionString && !host && !port && !user && !password && !database) {
    return null;
  }

  const settings: MySqlConnectionSettings = {
    waitForConnections: true,
    connectionLimit: Number(env.MYSQL_CONNECTION_LIMIT ?? 10),
    queueLimit: 0,
    decimalNumbers: true,
    dateStrings: true,
    namedPlaceholders: false,
    multipleStatements: true,
  };

  if (connectionString) {
    settings.uri = connectionString;
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

  return settings;
}
