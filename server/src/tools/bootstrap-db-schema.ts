import { getSharedMySqlAccess, isMySqlUnavailableError } from '../modules/persistence/mysql-access.js';

async function main(): Promise<void> {
  const mysqlAccess = getSharedMySqlAccess();

  if (!mysqlAccess) {
    console.log('[db:init] skipped: MySQL is not configured (set MYSQL_URL or MYSQL_HOST/PORT/USER/PASSWORD/DATABASE).');
    return;
  }

  try {
    await mysqlAccess.ensureReady();
    console.log('[db:init] MySQL schema is ready.');
  } finally {
    await mysqlAccess.close();
  }
}

main().catch((error) => {
  if (process.env.DB_FALLBACK_ON_UNAVAILABLE !== 'false' && isMySqlUnavailableError(error)) {
    console.warn('[db:init] skipped: MySQL is configured but unavailable. Set DB_FALLBACK_ON_UNAVAILABLE=false to fail instead.');
    console.warn('[db:init] reason:', error instanceof Error ? error.message : String(error));
    return;
  }

  console.error('[db:init] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
