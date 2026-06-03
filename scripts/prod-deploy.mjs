import { spawn } from 'node:child_process';

const pnpm = 'pnpm';
const useShell = process.platform === 'win32';

function buildEnv(extraEnv) {
  const mergedEnv = {
    ...process.env,
    ...extraEnv,
  };
  const cleanEnv = {};

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (!key || key.includes('=') || value === undefined || value === null) {
      continue;
    }
    cleanEnv[key] = String(value);
  }

  return cleanEnv;
}

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpm, args, {
      stdio: 'inherit',
      shell: useShell,
      env: buildEnv(env),
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
