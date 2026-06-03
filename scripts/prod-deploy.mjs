import { spawn } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
      },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${pnpm} ${args.join(' ')} failed${signal ? ` (${signal})` : ` (${code})`}`));
    });
  });
}

async function main() {
  await run(['install', '--frozen-lockfile', '--ignore-scripts']);
  await run(['build']);
  await run(['db:init'], {
    DB_AUTO_INIT: 'true',
    DB_FALLBACK_ON_UNAVAILABLE: 'false',
  });
  await run(['start'], {
    DB_AUTO_INIT: 'false',
    DB_FALLBACK_ON_UNAVAILABLE: 'false',
  });
}

main().catch((error) => {
  console.error('[prod:deploy] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
