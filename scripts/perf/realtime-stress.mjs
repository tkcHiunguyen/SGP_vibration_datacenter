import { io } from 'socket.io-client';

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8080',
  devices: 500,
  intervalMs: 1000,
  spectrumBins: 64,
  durationMs: 60_000,
};

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) options.baseUrl = arg.slice('--url='.length);
    if (arg.startsWith('--devices=')) options.devices = Math.max(1, Number(arg.slice('--devices='.length)) || 1);
    if (arg.startsWith('--interval-ms=')) options.intervalMs = Math.max(100, Number(arg.slice('--interval-ms='.length)) || DEFAULTS.intervalMs);
    if (arg.startsWith('--spectrum-bins=')) options.spectrumBins = Math.max(8, Number(arg.slice('--spectrum-bins='.length)) || DEFAULTS.spectrumBins);
    if (arg.startsWith('--duration-ms=')) options.durationMs = Math.max(1_000, Number(arg.slice('--duration-ms='.length)) || DEFAULTS.durationMs);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const runId = `perf-${Date.now().toString(36)}`;
const deviceIds = Array.from({ length: options.devices }, (_, index) => `${runId}-${String(index + 1).padStart(3, '0')}`);
const sockets = [];

async function registerDevices() {
  const batchSize = 25;
  for (let start = 0; start < deviceIds.length; start += batchSize) {
    const batch = deviceIds.slice(start, start + batchSize);
    await Promise.all(batch.map(async (deviceId, index) => {
      const response = await fetch(`${options.baseUrl}/api/devices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          name: `Performance sensor ${start + index + 1}`,
          site: 'PERF',
          zone: `LOAD-${(start + index) % 10}`,
          firmwareVersion: 'perf-1.0',
        }),
      });
      if (!response.ok && response.status !== 409) {
        throw new Error(`Cannot register ${deviceId}: ${response.status}`);
      }
    }));
  }
}

function makeSpectrumValues(deviceIndex, axisIndex) {
  const values = Array.from({ length: options.spectrumBins }, () => 0);
  values[(deviceIndex * 7 + axisIndex * 11) % values.length] = 0.25 + axisIndex * 0.1;
  return values;
}

function emitTick(tick) {
  const timestamp = new Date().toISOString();
  for (const [index, socket] of sockets.entries()) {
    const deviceId = deviceIds[index];
    const telemetryUuid = `${deviceId}-${tick}`;
    const base = 0.08 + (index % 20) * 0.01;
    socket.emit('device:heartbeat', {
      socketConnected: true,
      staConnected: true,
      signal: -45 - (index % 30),
      uptimeSec: tick * Math.round(options.intervalMs / 1000),
    });
    socket.emit('device:telemetry', {
      uuid: telemetryUuid,
      ts: timestamp,
      temperature: 24 + (index % 7),
      ax: base,
      ay: base * 0.8,
      az: base * 0.6,
      sample_count: 256,
      sample_rate_hz: 3200,
    });
    for (const [axisIndex, axis] of ['x', 'y', 'z'].entries()) {
      socket.emit(`device:telemetry:${axis}spectrum`, {
        deviceId,
        telemetryUuid,
        source_sample_count: 256,
        sample_rate_hz: 3200,
        bin_count: options.spectrumBins,
        bin_hz: 12.5,
        values: makeSpectrumValues(index, axisIndex),
      });
    }
  }
}

async function connectDevices() {
  await Promise.all(deviceIds.map((deviceId) => new Promise((resolve, reject) => {
    const socket = io(options.baseUrl, {
      transports: ['websocket'],
      auth: { clientType: 'device', deviceId },
      query: { clientType: 'device', deviceId },
      reconnection: false,
    });
    const timeout = setTimeout(() => reject(new Error(`Timed out connecting ${deviceId}`)), 15_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      sockets.push(socket);
      socket.emit('device:metadata', {
        name: `Performance sensor ${deviceId.slice(-3)}`,
        site: 'PERF',
        zone: `LOAD-${Number(deviceId.slice(-3)) % 10}`,
        firmwareVersion: 'perf-1.0',
      });
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  })));
}

await registerDevices();
await connectDevices();
console.log(`Connected ${sockets.length} simulated devices for ${options.durationMs}ms.`);

let tick = 0;
emitTick(tick);
const interval = setInterval(() => emitTick(++tick), options.intervalMs);

const stop = () => {
  clearInterval(interval);
  sockets.forEach((socket) => socket.disconnect());
  console.log(`Stopped after ${tick + 1} telemetry batches (${sockets.length} devices).`);
};

await new Promise((resolve) => setTimeout(resolve, options.durationMs));
stop();
