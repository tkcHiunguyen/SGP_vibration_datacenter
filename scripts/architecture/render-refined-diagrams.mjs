import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const sourceDir = 'docs/architecture/diagrams/refined';
const outputDir = 'docs/architecture/images';
const formats = ['svg', 'png'];
const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

mkdirSync(outputDir, { recursive: true });

const diagrams = readdirSync(sourceDir)
  .filter((file) => file.endsWith('.mmd'))
  .sort();

if (diagrams.length === 0) {
  throw new Error(`No Mermaid diagrams found in ${sourceDir}`);
}

for (const diagram of diagrams) {
  const input = join(sourceDir, diagram);
  const name = basename(diagram, extname(diagram));

  for (const format of formats) {
    const output = join(outputDir, `${name}.${format}`);
    console.log(`Rendering ${output}`);
    execFileSync(
      'pnpm',
      [
        'dlx',
        '@mermaid-js/mermaid-cli',
        '-i',
        input,
        '-o',
        output,
        '-b',
        'white',
        '-t',
        'default',
      ],
      {
        env: {
          ...process.env,
          ...(chromePath ? { PUPPETEER_EXECUTABLE_PATH: chromePath } : {}),
        },
        stdio: 'inherit',
      },
    );
  }
}
