import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEVICE_ID = process.env.DEVICE_ID || 'SIM-SETPOINT-01';
const SETPOINT = Number(process.env.SETPOINT || 10);
const BELOW_VALUE = Number(process.env.BELOW_VALUE || 8);
const ABOVE_VALUE = Number(process.env.ABOVE_VALUE || 12);
const SAMPLE_INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS || 2000);
const PHASE_DURATION_MS = Number(process.env.PHASE_DURATION_MS || 10000);
const DEVICE_AUTH_TOKEN = process.env.DEVICE_AUTH_TOKEN || '';

async function upsertDevice() {
  const response = await fetch(`${BASE_URL}/api/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: DEVICE_ID,
      name: 'Mo phong setpoint A V D Temp',
      site: 'SIM',
      firmwareVersion: 'setpoint-demo-1.0',
      accelerationSetpoint: SETPOINT,
      vibrationSetpoint: SETPOINT,
      displacementSetpoint: SETPOINT,
      temperatureSetpoint: SETPOINT,
      axisLabels: { ax: 'Truc X', ay: 'Truc Y', az: 'Truc Z' },
      notes: 'Thiet bi mo phong A, V, D va Temp luan phien duoi va tren setpoint.',
    }),
  });

  if (!response.ok) {
    throw new Error(`device upsert failed ${response.status}: ${await response.text()}`);
  }
}

await upsertDevice();

const auth = { clientType: 'device', deviceId: DEVICE_ID };
if (DEVICE_AUTH_TOKEN) {
  auth.token = DEVICE_AUTH_TOKEN;
}

const socket = io(BASE_URL, {
  transports: ['websocket'],
  auth,
  query: auth,
});

const startedAt = Date.now();
let lastPhase = -1;

function sendTelemetry() {
  const elapsedMs = Date.now() - startedAt;
  const phase = Math.floor(elapsedMs / PHASE_DURATION_MS);
  const aboveSetpoint = phase % 2 === 1;
  const baseValue = aboveSetpoint ? ABOVE_VALUE : BELOW_VALUE;
  const value = Number((baseValue + Math.sin(elapsedMs / 1400) * 0.25).toFixed(3));
  const telemetryUuid = randomUUID();

  if (phase !== lastPhase) {
    lastPhase = phase;
    console.log(`${aboveSetpoint ? 'ABOVE' : 'BELOW'} A/V/D/Temp setpoints: ${baseValue}`);
  }

  socket.emit('device:heartbeat', {
    socketConnected: true,
    staConnected: true,
    signal: -42,
    uptimeSec: Math.floor(elapsedMs / 1000),
  });
  socket.emit('device:telemetry', {
    uuid: telemetryUuid,
    messageId: telemetryUuid,
    ts: new Date().toISOString(),
    temperature: value,
    temperatureAvailable: true,
    vibration: value,
    vibrationAvailable: true,
    ax: value,
    ay: Number((value * 0.8).toFixed(3)),
    az: Number((value * 0.6).toFixed(3)),
    vrms_x_mms: value,
    vrms_y_mms: Number((value * 0.8).toFixed(3)),
    vrms_z_mms: Number((value * 0.6).toFixed(3)),
    vrms_unit: 'mm/s',
    drms_x_um: Number((value * 1000).toFixed(3)),
    drms_y_um: Number((value * 800).toFixed(3)),
    drms_z_um: Number((value * 600).toFixed(3)),
    drms_unit: 'um',
    sample_count: 1024,
    simulated: true,
  });
}

socket.on('connect', () => {
  console.log(`connected ${DEVICE_ID} at ${BASE_URL}`);
  sendTelemetry();
  setInterval(sendTelemetry, SAMPLE_INTERVAL_MS);
});

socket.on('connect_error', (error) => {
  console.error('connect_error', error.message);
});

socket.on('device:error', (error) => {
  console.error('device:error', JSON.stringify(error));
});

function shutdown() {
  socket.disconnect();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
