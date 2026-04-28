import { Project, Node, SyntaxKind } from 'ts-morph';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const generatedDir = path.join(repoRoot, 'docs/architecture/generated');
const diagramsDir = path.join(repoRoot, 'docs/architecture/diagrams');
await mkdir(generatedDir, { recursive: true });
await mkdir(diagramsDir, { recursive: true });

const projects = [
  { name: 'server', tsconfig: 'server/tsconfig.json', root: 'server/src' },
  { name: 'client', tsconfig: 'server/client/tsconfig.json', root: 'server/client/src' },
];

const sourceFiles = [];
for (const item of projects) {
  const project = new Project({ tsConfigFilePath: path.join(repoRoot, item.tsconfig), skipAddingFilesFromTsConfig: false });
  for (const file of project.getSourceFiles()) {
    const filePath = normalizePath(path.relative(repoRoot, file.getFilePath()));
    if (filePath.startsWith(item.root)) {
      sourceFiles.push({ project: item.name, file, filePath });
    }
  }
}

const routeMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
const routes = [];
const socketEvents = [];
const services = [];
const repositories = [];
const frontendApiCalls = [];
const frontendSocketCalls = [];
const moduleImports = new Map();

for (const { project, file, filePath } of sourceFiles) {
  const moduleName = moduleFromPath(filePath);
  if (!moduleImports.has(moduleName)) moduleImports.set(moduleName, new Set());

  for (const declaration of file.getImportDeclarations()) {
    const spec = declaration.getModuleSpecifierValue();
    if (spec.startsWith('.')) {
      const imported = resolveRelativeModule(filePath, spec);
      moduleImports.get(moduleName).add(moduleFromPath(imported));
    }
  }

  for (const cls of file.getClasses()) {
    const name = cls.getName() ?? '<anonymous>';
    if (name.endsWith('Service')) services.push({ name, file: filePath, module: moduleName });
    if (name.endsWith('Repository')) repositories.push({ name, file: filePath, module: moduleName });
  }

  file.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    const args = node.getArguments();
    const line = node.getStartLineNumber();

    if (Node.isPropertyAccessExpression(expression)) {
      const method = expression.getName();
      const receiver = expression.getExpression().getText();
      const firstArg = args[0];
      const literal = stringLiteral(firstArg);

      if (literal && routeMethods.has(method) && isRouteReceiver(receiver)) {
        routes.push({ method: method.toUpperCase(), path: literal, file: filePath, line, module: moduleName });
      }

      if (literal && ['on', 'once'].includes(method) && isSocketReceiver(receiver)) {
        socketEvents.push({ direction: 'inbound', event: literal, file: filePath, line, module: moduleName, receiver });
      }

      if (literal && ['emit', 'to'].includes(method) && isSocketReceiver(receiver)) {
        socketEvents.push({ direction: method === 'emit' ? 'outbound' : 'room-target', event: literal, file: filePath, line, module: moduleName, receiver });
      }

      if (project === 'client' && literal && ['on', 'once', 'emit'].includes(method) && /socket/i.test(receiver)) {
        frontendSocketCalls.push({ direction: method === 'emit' ? 'client-to-server' : 'server-to-client', event: literal, file: filePath, line });
      }
    }

    if (project === 'client' && Node.isIdentifier(expression) && expression.getText() === 'fetch') {
      const firstArg = args[0];
      const url = stringLiteral(firstArg) ?? templatePrefix(firstArg);
      frontendApiCalls.push({ url: url ?? '<dynamic>', file: filePath, line });
    }
  });
}

const modules = buildModules(sourceFiles, moduleImports, services, repositories, routes, socketEvents);
const summary = {
  generatedAt: new Date().toISOString(),
  counts: {
    files: sourceFiles.length,
    modules: modules.length,
    routes: routes.length,
    socketEvents: socketEvents.length,
    services: services.length,
    repositories: repositories.length,
    frontendApiCalls: frontendApiCalls.length,
    frontendSocketCalls: frontendSocketCalls.length,
  },
};

const artifacts = { summary, modules, routes, socketEvents, services, repositories, frontendApiCalls, frontendSocketCalls };
for (const [name, data] of Object.entries(artifacts)) {
  await writeJson(path.join(generatedDir, `${kebab(name)}.json`), data);
}

await writeFile(path.join(diagramsDir, 'system-context.mmd'), systemContextMermaid(), 'utf8');
await writeFile(path.join(diagramsDir, 'backend-module-map.mmd'), backendModuleMermaid(modules), 'utf8');
await writeFile(path.join(diagramsDir, 'api-map.mmd'), routeMermaid(routes), 'utf8');
await writeFile(path.join(diagramsDir, 'socket-event-map.mmd'), socketMermaid(socketEvents, frontendSocketCalls), 'utf8');
await writeFile(path.join(diagramsDir, 'data-flows.mmd'), dataFlowsMermaid(), 'utf8');
await writeFile(path.join(repoRoot, 'docs/architecture/GENERATED_OVERVIEW.md'), generatedOverview(summary), 'utf8');

console.log(`[arch] generated ${Object.keys(artifacts).length} JSON artifacts and Mermaid diagrams`);
console.log(`[arch] routes=${routes.length}, socketEvents=${socketEvents.length}, modules=${modules.length}`);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function stringLiteral(node) {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralText();
  return null;
}

function templatePrefix(node) {
  if (!node || !Node.isTemplateExpression(node)) return null;
  return `${node.getHead().getLiteralText()}<dynamic>`;
}

function isRouteReceiver(receiver) {
  return receiver === 'app' || receiver.endsWith('app') || receiver.includes('fastify');
}

function isSocketReceiver(receiver) {
  return /socket|client|gateway|io|server/i.test(receiver);
}

function resolveRelativeModule(fromFile, spec) {
  const base = path.posix.dirname(fromFile);
  let resolved = path.posix.normalize(path.posix.join(base, spec));
  if (!resolved.endsWith('.ts') && !resolved.endsWith('.tsx')) resolved += '.ts';
  return resolved;
}

function moduleFromPath(filePath) {
  if (filePath.startsWith('server/src/modules/')) return filePath.split('/').slice(0, 4).join('/');
  if (filePath.startsWith('server/src/shared/')) return 'server/src/shared';
  if (filePath.startsWith('server/src/tools/')) return 'server/src/tools';
  if (filePath.startsWith('server/client/src/app/components/ui/')) return 'server/client/src/app/components/ui';
  if (filePath.startsWith('server/client/src/app/components/')) return 'server/client/src/app/components';
  if (filePath.startsWith('server/client/src/app/context/')) return 'server/client/src/app/context';
  if (filePath.startsWith('server/client/src/app/data/')) return 'server/client/src/app/data';
  if (filePath.startsWith('server/client/src/styles/')) return 'server/client/src/styles';
  if (filePath.startsWith('server/client/src/')) return 'server/client/src/app-shell';
  return filePath.split('/').slice(0, 2).join('/');
}

function buildModules(files, imports, servicesList, reposList, routeList, eventList) {
  const names = new Set(files.map(({ filePath }) => moduleFromPath(filePath)));
  for (const [name, deps] of imports) {
    names.add(name);
    for (const dep of deps) names.add(dep);
  }
  return [...names].sort().map((name) => ({
    name,
    kind: moduleKind(name),
    files: files.filter(({ filePath }) => moduleFromPath(filePath) === name).map(({ filePath }) => filePath).sort(),
    imports: [...(imports.get(name) ?? [])].filter((item) => item !== name).sort(),
    services: servicesList.filter((item) => item.module === name).map((item) => item.name).sort(),
    repositories: reposList.filter((item) => item.module === name).map((item) => item.name).sort(),
    routes: routeList.filter((item) => item.module === name).length,
    socketEvents: eventList.filter((item) => item.module === name).length,
  }));
}

function moduleKind(name) {
  if (name.startsWith('server/src/modules/')) return 'backend-module';
  if (name.startsWith('server/src/shared')) return 'backend-shared';
  if (name.startsWith('server/client')) return 'frontend';
  return 'other';
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function kebab(value) {
  return value.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function id(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function label(value) {
  return value.replace(/"/g, '\\"');
}

function systemContextMermaid() {
  return `flowchart LR\n  Sensor[Sensor Devices]\n  Browser[Browser Dashboard]\n  Server[Fastify + Socket.IO Server :8080]\n  MySQL[(MySQL)]\n  Static[server/public/app]\n  Storage[(Local runtime storage)]\n\n  Sensor -->|Socket.IO telemetry / spectrum / heartbeat| Server\n  Server -->|commands / OTA| Sensor\n  Browser -->|REST API + Socket.IO| Server\n  Server -->|serves app shell| Browser\n  Server --> MySQL\n  Server --> Storage\n  Static --> Server\n`;
}

function backendModuleMermaid(moduleList) {
  const backend = moduleList.filter((item) => item.name.startsWith('server/src/modules/'));
  const lines = ['flowchart TD', '  Entry[server/src/index.ts]'];
  for (const mod of backend) lines.push(`  ${id(mod.name)}[${label(mod.name.replace('server/src/modules/', ''))}]`);
  for (const mod of backend) lines.push(`  Entry --> ${id(mod.name)}`);
  for (const mod of backend) {
    for (const dep of mod.imports.filter((item) => item.startsWith('server/src/modules/'))) {
      if (dep !== mod.name) lines.push(`  ${id(mod.name)} --> ${id(dep)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function routeMermaid(routeList) {
  const groups = groupBy(routeList, (route) => route.module);
  const lines = ['flowchart TD', '  Browser[Browser]', '  Routes[HTTP route layer]'];
  for (const [moduleName, items] of Object.entries(groups).sort()) {
    const nodeId = id(moduleName);
    lines.push(`  ${nodeId}[${label(moduleName.replace('server/src/modules/', ''))}<br/>${items.length} routes]`);
    lines.push(`  Browser --> Routes --> ${nodeId}`);
  }
  return `${lines.join('\n')}\n`;
}

function socketMermaid(serverEvents, clientEvents) {
  const inbound = serverEvents.filter((event) => event.direction === 'inbound');
  const outbound = serverEvents.filter((event) => event.direction === 'outbound');
  const lines = ['flowchart LR', '  Sensor[Sensor Device]', '  Browser[Browser Client]', '  Socket[Socket.IO Handlers]', '  Services[Backend Services]'];
  for (const event of uniqueBy(inbound, (item) => item.event).slice(0, 30)) lines.push(`  Sensor -->|${label(event.event)}| Socket`);
  for (const event of uniqueBy(outbound, (item) => item.event).slice(0, 30)) lines.push(`  Socket -->|${label(event.event)}| Browser`);
  for (const event of uniqueBy(clientEvents, (item) => item.event).slice(0, 20)) {
    const arrow = event.direction === 'client-to-server' ? '-->' : '<--';
    lines.push(`  Browser ${arrow}|${label(event.event)}| Socket`);
  }
  lines.push('  Socket --> Services');
  return `${lines.join('\n')}\n`;
}

function dataFlowsMermaid() {
  return `flowchart TD\n  Sensor[Sensor Device]\n  Socket[socket.handlers.ts]\n  Guard[TelemetryIngressGuard]\n  Device[DeviceService]\n  Telemetry[TelemetryService]\n  Spectrum[SpectrumStorageService]\n  Alert[AlertService]\n  DB[(MySQL / Storage)]\n  API[register-routes.ts]\n  UI[React Dashboard]\n\n  Sensor -->|telemetry| Socket --> Guard --> Telemetry --> DB\n  Socket --> Device\n  Telemetry --> Alert\n  Sensor -->|spectrum frame| Socket --> Spectrum --> DB\n  UI -->|REST fetch| API --> Telemetry\n  UI -->|REST fetch| API --> Spectrum\n  Socket -->|broadcast realtime update| UI\n`;
}

function generatedOverview(info) {
  return `# Generated Architecture Overview\n\nGenerated at: ${info.generatedAt}\n\n## Counts\n\n| Artifact | Count |\n| --- | ---: |\n| Source files | ${info.counts.files} |\n| Modules | ${info.counts.modules} |\n| HTTP routes | ${info.counts.routes} |\n| Socket events | ${info.counts.socketEvents} |\n| Services | ${info.counts.services} |\n| Repositories | ${info.counts.repositories} |\n| Frontend API calls | ${info.counts.frontendApiCalls} |\n| Frontend socket calls | ${info.counts.frontendSocketCalls} |\n\n## Generated Files\n\n- \`docs/architecture/generated/summary.json\`\n- \`docs/architecture/generated/modules.json\`\n- \`docs/architecture/generated/routes.json\`\n- \`docs/architecture/generated/socket-events.json\`\n- \`docs/architecture/generated/services.json\`\n- \`docs/architecture/generated/repositories.json\`\n- \`docs/architecture/generated/frontend-api-calls.json\`\n- \`docs/architecture/generated/frontend-socket-calls.json\`\n- \`docs/architecture/diagrams/system-context.mmd\`\n- \`docs/architecture/diagrams/backend-module-map.mmd\`\n- \`docs/architecture/diagrams/api-map.mmd\`\n- \`docs/architecture/diagrams/socket-event-map.mmd\`\n- \`docs/architecture/diagrams/data-flows.mmd\`\n`;
}

function groupBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] ??= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
