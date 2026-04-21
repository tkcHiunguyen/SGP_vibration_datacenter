import { getSharedMySqlAccess } from '../modules/persistence/mysql-access.js';

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
  console.error('[db:init] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
