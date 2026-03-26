import { io, type Socket } from 'socket.io-client';

type SimConfig = {
  url: string;
  count: number;
  intervalMs: number;
  heartbeatMs: number;
  rampStepMs: number;
  token?: string;
  durationSec?: number;
};

function readArg(name: string, fallback?: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function loadConfig(): SimConfig {
  return {
    url: readArg('url', process.env.SIM_URL || 'http://localhost:8080')!,
    count: toPositiveInt(readArg('count', process.env.SIM_COUNT), 20),
    intervalMs: toPositiveInt(readArg('interval', process.env.SIM_INTERVAL_MS), 1000),
    heartbeatMs: toPositiveInt(readArg('heartbeat', process.env.SIM_HEARTBEAT_MS), 15000),
    rampStepMs: toPositiveInt(readArg('ramp-step', process.env.SIM_RAMP_STEP_MS), 0),
    token: readArg('token', process.env.DEVICE_AUTH_TOKEN),
    durationSec: Number.isFinite(Number(readArg('duration', process.env.SIM_DURATION_SEC)))
      ? Number(readArg('duration', process.env.SIM_DURATION_SEC))
      : undefined,
  };
}

function randomInRange(min: number, max: number): number {
  return Number((min + Math.random() * (max - min)).toFixed(4));
}

function createDeviceSocket(deviceId: string, config: SimConfig): Socket {
  return io(config.url, {
    transports: ['websocket'],
    auth: {
      clientType: 'device',
      deviceId,
      token: config.token || '',
    },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    timeout: 8000,
  });
}

function startDevice(deviceId: string, config: SimConfig): { stop: () => void } {
  const socket = createDeviceSocket(deviceId, config);

  let telemetryTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  socket.on('connect', () => {
    console.log(`[${deviceId}] connected (${socket.id})`);

    telemetryTimer = setInterval(() => {
      const telemetry = {
        vibration: randomInRange(0.01, 0.9),
        temperature: randomInRange(24, 45),
        ax: randomInRange(-0.2, 0.2),
        ay: randomInRange(-0.2, 0.2),
        az: randomInRange(0.85, 1.15),
        signal: Math.floor(randomInRange(-85, -50)),
      };
      socket.emit('device:telemetry', telemetry);
    }, config.intervalMs);

    heartbeatTimer = setInterval(() => {
      socket.emit('device:heartbeat', {});
    }, config.heartbeatMs);
  });

  socket.on('device:ack', (payload) => {
    console.log(`[${deviceId}] ack =>`, payload);
  });

  socket.on('device:error', (payload) => {
    console.error(`[${deviceId}] error =>`, payload);
  });

  socket.on('device:command', (command: { commandId?: string; type?: string; payload?: unknown }) => {
    console.log(`[${deviceId}] command =>`, command);
    if (command?.commandId) {
      socket.emit('device:command:ack', { commandId: command.commandId });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[${deviceId}] disconnected: ${reason}`);
  });

  const stop = () => {
    if (telemetryTimer) {
      clearInterval(telemetryTimer);
      telemetryTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    socket.disconnect();
  };

  return { stop };
}

function main() {
  const config = loadConfig();
  console.log('Simulator config:', config);

  const devices: Array<{ stop: () => void }> = [];
  const startupTimers: NodeJS.Timeout[] = [];

  for (let i = 0; i < config.count; i += 1) {
    const deviceId = `esp-${String(i + 1).padStart(3, '0')}`;
    const delayMs = config.rampStepMs * i;
    if (delayMs <= 0) {
      devices.push(startDevice(deviceId, config));
      continue;
    }

    const timer = setTimeout(() => {
      devices.push(startDevice(deviceId, config));
    }, delayMs);
    startupTimers.push(timer);
  }

  const shutdown = () => {
    console.log('Stopping simulator...');
    for (const timer of startupTimers) {
      clearTimeout(timer);
    }
    for (const device of devices) {
      device.stop();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (config.durationSec && config.durationSec > 0) {
    setTimeout(() => shutdown(), config.durationSec * 1000);
  }
}

main();
