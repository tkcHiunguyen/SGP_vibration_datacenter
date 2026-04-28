import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MYSQL_SCHEMA_SQL } from '../modules/persistence/mysql-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = resolve(__dirname, '../../../docs/database/mysql-schema.sql');

async function main(): Promise<void> {
  const sql = `${MYSQL_SCHEMA_SQL.trim()}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, sql, 'utf8');
  console.log(`[db:schema:export] wrote ${outputPath}`);
}

main().catch((error) => {
  console.error('[db:schema:export] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
