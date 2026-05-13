import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEVICE_ID = process.env.DEVICE_ID || 'sine-500hz-peak60';
const FREQ_HZ = Number(process.env.FREQ_HZ || 500);
const PEAK_MPS2 = Number(process.env.PEAK_MPS2 || 60);
const SAMPLE_RATE_HZ = Number(process.env.SAMPLE_RATE_HZ || 3200);
const SOURCE_SAMPLE_COUNT = Number(process.env.SOURCE_SAMPLE_COUNT || 1024);
const BIN_COUNT = Number(process.env.BIN_COUNT || 512);
const AXIS = process.env.AXIS || 'x';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 1000);
const RMS = PEAK_MPS2 / Math.SQRT2;
const BIN_HZ = SAMPLE_RATE_HZ / SOURCE_SAMPLE_COUNT;
const BIN_INDEX = Math.round(FREQ_HZ / BIN_HZ) - 1; // server displays freq=(index+1)*binHz

async function upsertDevice() {
  const res = await fetch(`${BASE_URL}/api/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: DEVICE_ID,
      name: `SIM sine ${FREQ_HZ}Hz peak ${PEAK_MPS2}m/s²`,
      site: 'SIM',
      firmwareVersion: 'sim-sine-1.0',
      axisLabels: { ax: 'Sine X', ay: 'Y', az: 'Z' },
      notes: `Simulated sine wave. freq=${FREQ_HZ}Hz, peak=${PEAK_MPS2}m/s², rms=${RMS.toFixed(6)}m/s²`,
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`device create failed ${res.status}: ${await res.text()}`);
  }
  if (res.status === 409) {
    await fetch(`${BASE_URL}/api/devices/${encodeURIComponent(DEVICE_ID)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `SIM sine ${FREQ_HZ}Hz peak ${PEAK_MPS2}m/s²`,
        site: 'SIM',
        zone: 'TEST',
        firmwareVersion: 'sim-sine-1.0',
        axisLabels: { ax: 'Sine X', ay: 'Y', az: 'Z' },
        notes: `Simulated sine wave. freq=${FREQ_HZ}Hz, peak=${PEAK_MPS2}m/s², rms=${RMS.toFixed(6)}m/s²`,
      }),
    });
  }
}

function spectrumPayload(telemetryUuid, axis) {
  const values = Array.from({ length: BIN_COUNT }, () => 0);
  if (BIN_INDEX >= 0 && BIN_INDEX < values.length) values[BIN_INDEX] = RMS;
  return {
    deviceId: DEVICE_ID,
    telemetryUuid,
    source_sample_count: SOURCE_SAMPLE_COUNT,
    sample_rate_hz: SAMPLE_RATE_HZ,
    bin_count: BIN_COUNT,
    bin_hz: BIN_HZ,
    value_scale: 1,
    magnitude_unit: 'm/s²',
    values: axis === AXIS ? values : Array.from({ length: BIN_COUNT }, () => 0),
  };
}

await upsertDevice();

const socket = io(BASE_URL, {
  transports: ['websocket'],
  auth: { clientType: 'device', deviceId: DEVICE_ID },
  query: { clientType: 'device', deviceId: DEVICE_ID },
});

socket.on('connect', () => {
  console.log(`connected ${DEVICE_ID}`);
  console.log(`sine ${FREQ_HZ}Hz peak=${PEAK_MPS2}m/s² rms=${RMS.toFixed(6)}m/s² bin=${BIN_INDEX + 1} binHz=${BIN_HZ}`);
  tick();
  setInterval(tick, INTERVAL_MS);
});

socket.on('connect_error', (err) => console.error('connect_error', err.message));
socket.on('device:ack', (ack) => console.log('ack', JSON.stringify(ack)));

function tick() {
  const telemetryUuid = crypto.randomUUID();
  socket.emit('device:telemetry', {
    uuid: telemetryUuid,
    ts: new Date().toISOString(),
    vibration: RMS,
    temperature: 25,
    ax: AXIS === 'x' ? RMS : 0,
    ay: AXIS === 'y' ? RMS : 0,
    az: AXIS === 'z' ? RMS : 0,
    simulated: true,
    signal: { type: 'sine', frequencyHz: FREQ_HZ, peakMps2: PEAK_MPS2, rmsMps2: RMS },
  });
  socket.emit('device:telemetry:xspectrum', spectrumPayload(telemetryUuid, 'x'));
  socket.emit('device:telemetry:yspectrum', spectrumPayload(telemetryUuid, 'y'));
  socket.emit('device:telemetry:zspectrum', spectrumPayload(telemetryUuid, 'z'));
}
