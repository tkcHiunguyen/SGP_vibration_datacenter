import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const generatedDir = path.join(repoRoot, 'docs/architecture/generated');
await mkdir(generatedDir, { recursive: true });

await run('node', ['scripts/architecture/extract-architecture.mjs']);
await runCapture('pnpm', ['exec', 'knip', '--reporter', 'json'], path.join(generatedDir, 'knip.json'), { allowFailure: true });
await runCapture('pnpm', ['exec', 'knip'], path.join(generatedDir, 'knip.txt'), { allowFailure: true });
await runCapture('pnpm', ['exec', 'madge', 'server/src', 'server/client/src', '--extensions', 'ts,tsx', '--json'], path.join(generatedDir, 'madge.json'));
await runCapture('pnpm', ['exec', 'madge', 'server/src', 'server/client/src', '--extensions', 'ts,tsx', '--circular'], path.join(generatedDir, 'madge-circular.txt'), { allowFailure: true });
await runCapture('pnpm', ['exec', 'depcruise', 'server/src', 'server/client/src', '--no-config', '--output-type', 'json'], path.join(generatedDir, 'dependency-cruiser.json'));
await runCapture('pnpm', ['exec', 'depcruise', 'server/src', 'server/client/src', '--no-config', '--output-type', 'dot'], path.join(generatedDir, 'dependency-cruiser.dot'));

console.log('[arch] architecture analysis complete');
console.log('[arch] generated files under docs/architecture/generated and docs/architecture/diagrams');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[arch] ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0 || options.allowFailure) resolve(code);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

function runCapture(command, args, outputFile, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[arch] ${command} ${args.join(' ')} > ${path.relative(repoRoot, outputFile)}`);
    const child = spawn(command, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const chunks = [];
    const errors = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('close', async (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      const errorOutput = Buffer.concat(errors).toString('utf8');
      const combined = output || errorOutput;
      await import('node:fs/promises').then(({ writeFile }) => writeFile(outputFile, combined, 'utf8'));
      if (code === 0 || options.allowFailure) resolve(code);
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}\n${errorOutput}`));
    });
  });
}
