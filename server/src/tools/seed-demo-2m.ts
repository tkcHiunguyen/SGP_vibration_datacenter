import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import dotenv from 'dotenv';
import { io, type Socket } from 'socket.io-client';

import type { TelemetrySpectrumMessage } from '../shared/types.js';
import { MySqlAccess } from '../modules/persistence/mysql-access.js';
import { resolveMySqlConnectionSettings } from '../modules/persistence/mysql-env.js';
import { SpectrumStorageService } from '../modules/spectrum/spectrum-storage.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(__dirname, '../..');
dotenv.config({ path: resolve(serverRoot, '.env') });

const DEMO_PREFIX = 'DEMO-2M';
const SEED_KEY = 'demo-2m-v1';
const SEED_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 60;
const BATCH_SIZE = 2_000;
const SPECTRUM_FRAME_DAYS = [14, 42] as const;

type SqlParam = string | number | boolean | null | Date | Buffer;

type GapWindow = {
  startsAt: number;
  endsAt: number;
  reason: string;
};

type DemoProfile = {
  deviceId: string;
  zoneCode: string;
  zoneName: string;
  zoneDescription: string;
  name: string;
  site: string;
  baseTemperature: number;
  baseVibration: number;
  currentSignal: number;
  offlineWindows: GapWindow[];
  noDataWindows: GapWindow[];
  anomalyWindows: GapWindow[];
  currentOffline: boolean;
};

type SeedRunRow = {
  seed_key: string;
  seed_version: number | string;
  started_at: string | Date;
  ended_at: string | Date;
  expected_records: number | string;
  status: string;
};

type CountRow = {
  total: number | string;
};

type TelemetryReferenceRow = {
  received_at: string | Date;
  telemetry_uuid: string;
};

type DbSizeRow = {
  database_name: string | null;
  bytes: number | string | null;
};

type CadenceRow = {
  min_seconds: number | string | null;
  max_seconds: number | string | null;
  violations: number | string | null;
};

type CoverageRow = {
  first_at: string | Date | null;
  last_at: string | Date | null;
};

type DemoSummary = {
  database: string | null;
  startAt: string;
  endAt: string;
  expectedTelemetryRecords: number;
  actualTelemetryRecords: number;
  demoZones: number;
  demoDevices: number;
  offlineIntervals: number;
  currentOfflineIntervals: number;
  cadenceMinSeconds: number;
  cadenceMaxSeconds: number;
  cadenceViolations: number;
  noDataGapSeconds: number;
  firstTelemetryAt: string | null;
  lastTelemetryAt: string | null;
  spectrumFrames: number;
  databaseBytes: number;
};

type TelemetryRow = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
  number,
  number,
  number,
  number,
  number,
  string,
  number,
  string,
];

function toIso(value: number | string | Date): string {
  if (typeof value === 'string') {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const withTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
    return new Date(withTimezone).toISOString();
  }
  return new Date(value).toISOString();
}

function toCount(value: number | string | null | undefined): number {
  return Math.max(0, Math.floor(Number(value ?? 0)));
}

function toMySqlDate(value: number | string | Date): string {
  return new Date(value).toISOString().slice(0, 23).replace('T', ' ');
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function contains(window: GapWindow, timestamp: number): boolean {
  return timestamp >= window.startsAt && timestamp < window.endsAt;
}

function matchesAny(windows: GapWindow[], timestamp: number): boolean {
  return windows.some((window) => contains(window, timestamp));
}

function createProfiles(startAt: number, endAt: number): DemoProfile[] {
  const atDay = (day: number, hour = 0, durationHours = 1, reason = 'planned_demo_window'): GapWindow => ({
    startsAt: startAt + day * DAY_MS + hour * 60 * 60 * 1000,
    endsAt: startAt + day * DAY_MS + (hour + durationHours) * 60 * 60 * 1000,
    reason,
  });
  const currentOffline = (hours: number, reason: string): GapWindow => ({
    startsAt: endAt - hours * 60 * 60 * 1000,
    endsAt: endAt,
    reason,
  });

  return [
    {
      deviceId: `${DEMO_PREFIX}-CW-PUMP-01`,
      zoneCode: `${DEMO_PREFIX}-COOLING-WATER`,
      zoneName: 'Demo - Bom nuoc lam mat',
      zoneDescription: 'Khu vuc bom nuoc lam mat mo phong trong 60 ngay.',
      name: 'CW Pump 01 - Van hanh on dinh',
      site: 'Datacenter Demo A',
      baseTemperature: 34.8,
      baseVibration: 1.18,
      currentSignal: -63,
      offlineWindows: [],
      noDataWindows: [],
      anomalyWindows: [],
      currentOffline: false,
    },
    {
      deviceId: `${DEMO_PREFIX}-CHILLER-01`,
      zoneCode: `${DEMO_PREFIX}-CHILLER`,
      zoneName: 'Demo - Chiller 01',
      zoneDescription: 'Khu vuc chiller voi su kien rung cao da phuc hoi.',
      name: 'Chiller 01 - Da phuc hoi canh bao',
      site: 'Datacenter Demo A',
      baseTemperature: 31.2,
      baseVibration: 1.36,
      currentSignal: -68,
      offlineWindows: [],
      noDataWindows: [],
      anomalyWindows: [atDay(31, 6, 5, 'elevated_vibration_recovered')],
      currentOffline: false,
    },
    {
      deviceId: `${DEMO_PREFIX}-UPS-01`,
      zoneCode: `${DEMO_PREFIX}-UPS`,
      zoneName: 'Demo - UPS 01',
      zoneDescription: 'Khu vuc UPS co cac lan mat ket noi socket ngan han.',
      name: 'UPS 01 - Mat tin hieu gian doan',
      site: 'Datacenter Demo B',
      baseTemperature: 29.5,
      baseVibration: 0.92,
      currentSignal: -72,
      offlineWindows: [
        atDay(12, 3, 3, 'socket_lost'),
        atDay(47, 17, 1.5, 'ping_timeout'),
      ],
      noDataWindows: [],
      anomalyWindows: [],
      currentOffline: false,
    },
    {
      deviceId: `${DEMO_PREFIX}-CRAC-01`,
      zoneCode: `${DEMO_PREFIX}-CRAC`,
      zoneName: 'Demo - CRAC 01',
      zoneDescription: 'Khu vuc dieu hoa chinh xac co gap no-data khi van online.',
      name: 'CRAC 01 - Khoang no-data',
      site: 'Datacenter Demo B',
      baseTemperature: 26.8,
      baseVibration: 1.08,
      currentSignal: -70,
      offlineWindows: [],
      noDataWindows: [
        atDay(22, 9, 6, 'telemetry_gap_no_data'),
        atDay(54, 1, 0.75, 'telemetry_gap_no_data'),
      ],
      anomalyWindows: [],
      currentOffline: false,
    },
    {
      deviceId: `${DEMO_PREFIX}-FAN-WALL-01`,
      zoneCode: `${DEMO_PREFIX}-FAN-WALL`,
      zoneName: 'Demo - Fan Wall 01',
      zoneDescription: 'Khu vuc fan wall co RSSI yeu va rung cao hien tai.',
      name: 'Fan Wall 01 - Canh bao dang hoat dong',
      site: 'Datacenter Demo C',
      baseTemperature: 33.7,
      baseVibration: 1.48,
      currentSignal: -91,
      offlineWindows: [],
      noDataWindows: [],
      anomalyWindows: [
        {
          startsAt: endAt - 12 * 60 * 60 * 1000,
          endsAt: endAt + 60 * 60 * 1000,
          reason: 'elevated_vibration_active',
        },
      ],
      currentOffline: false,
    },
    {
      deviceId: `${DEMO_PREFIX}-GENSET-01`,
      zoneCode: `${DEMO_PREFIX}-GENSET`,
      zoneName: 'Demo - May phat 01',
      zoneDescription: 'Khu vuc may phat dang offline tai thoi diem hien tai.',
      name: 'Genset 01 - Offline hien tai',
      site: 'Datacenter Demo C',
      baseTemperature: 36.1,
      baseVibration: 1.62,
      currentSignal: -76,
      offlineWindows: [
        atDay(18, 4, 2, 'socket_lost'),
        currentOffline(2, 'ping_timeout'),
      ],
      noDataWindows: [],
      anomalyWindows: [],
      currentOffline: true,
    },
  ];
}

function isSkipped(profile: DemoProfile, timestamp: number): boolean {
  return matchesAny(profile.offlineWindows, timestamp) || matchesAny(profile.noDataWindows, timestamp);
}

function expectedTelemetryCount(profile: DemoProfile, startAt: number, endAt: number): number {
  const random = createPrng(hashString(`${SEED_KEY}:${profile.deviceId}`));
  let timestamp = startAt;
  let count = 0;
  while (timestamp <= endAt) {
    if (!isSkipped(profile, timestamp)) {
      count += 1;
    }
    timestamp += (5 + Math.floor(random() * 6)) * 1_000;
  }
  return count;
}

function createTelemetryRow(
  profile: DemoProfile,
  timestamp: number,
  sequence: number,
  random: () => number,
): TelemetryRow {
  const hourWave = Math.sin((timestamp / (60 * 60 * 1000)) * (Math.PI / 12));
  const loadWave = Math.sin((timestamp / (12 * 60 * 60 * 1000)) * Math.PI + sequence * 0.005);
  const noise = (random() - 0.5) * 0.08;
  const anomalous = matchesAny(profile.anomalyWindows, timestamp);
  const vibrationOffset = anomalous ? 1.15 + Math.max(0, loadWave) * 0.6 : 0;
  const temperatureOffset = anomalous ? 7.5 + Math.max(0, hourWave) * 2 : 0;
  const vibration = round(Math.max(0.1, profile.baseVibration + hourWave * 0.12 + noise + vibrationOffset));
  const ax = round(vibration * (0.48 + random() * 0.08));
  const ay = round(vibration * (0.58 + random() * 0.09));
  const az = round(vibration * (0.42 + random() * 0.08));
  const vrmsX = round(vibration * (0.72 + random() * 0.05));
  const vrmsY = round(vibration * (0.9 + random() * 0.06));
  const vrmsZ = round(vibration * (0.64 + random() * 0.05));
  const drmsX = round(ax * 115 + random() * 6);
  const drmsY = round(ay * 115 + random() * 6);
  const drmsZ = round(az * 115 + random() * 6);
  const telemetryUuid = `${DEMO_PREFIX}:${profile.deviceId}:${timestamp}`;

  return [
    profile.deviceId,
    toMySqlDate(timestamp),
    round(profile.baseTemperature + hourWave * 1.4 + noise + temperatureOffset),
    vibration,
    ax,
    ay,
    az,
    vrmsX,
    vrmsY,
    vrmsZ,
    'mm/s RMS',
    drmsX,
    drmsY,
    drmsZ,
    10,
    500,
    'um RMS',
    1024,
    telemetryUuid,
  ];
}

async function createSeedMetadataTable(mysql: MySqlAccess): Promise<void> {
  await mysql.execute(`
    CREATE TABLE IF NOT EXISTS demo_seed_runs (
      seed_key VARCHAR(64) NOT NULL,
      seed_version INT NOT NULL,
      started_at DATETIME(3) NOT NULL,
      ended_at DATETIME(3) NOT NULL,
      expected_records BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (seed_key)
    )
  `);
}

async function ensureHourlyMetricSummariesTable(mysql: MySqlAccess): Promise<void> {
  await mysql.execute(`
    CREATE TABLE IF NOT EXISTS device_telemetry_hour_metric_summaries (
      device_id VARCHAR(191) NOT NULL,
      hour_started_at DATETIME NOT NULL,
      sample_count INT UNSIGNED NOT NULL,
      first_received_at DATETIME(3) NOT NULL,
      last_received_at DATETIME(3) NOT NULL,
      temperature DOUBLE NULL,
      vibration DOUBLE NULL,
      ax DOUBLE NULL,
      ay DOUBLE NULL,
      az DOUBLE NULL,
      vrms_x_mms DOUBLE NULL,
      vrms_y_mms DOUBLE NULL,
      vrms_z_mms DOUBLE NULL,
      vrms_unit VARCHAR(32) NULL,
      drms_x_um DOUBLE NULL,
      drms_y_um DOUBLE NULL,
      drms_z_um DOUBLE NULL,
      drms_band_min_hz DOUBLE NULL,
      drms_band_max_hz DOUBLE NULL,
      drms_unit VARCHAR(32) NULL,
      PRIMARY KEY (device_id, hour_started_at),
      KEY idx_device_telemetry_hour_metric_summaries_hour (hour_started_at),
      CONSTRAINT fk_device_telemetry_hour_metric_summaries_device
        FOREIGN KEY (device_id) REFERENCES devices(device_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
    )
  `);
}

async function loadOrCreateSeedWindow(mysql: MySqlAccess): Promise<{ startAt: number; endAt: number; expected: number }> {
  const existing = await mysql.query<SeedRunRow>(
    'SELECT seed_key, seed_version, started_at, ended_at, expected_records, status FROM demo_seed_runs WHERE seed_key = ? LIMIT 1',
    [SEED_KEY],
  );
  const marker = existing[0];
  if (marker) {
    if (Number(marker.seed_version) !== SEED_VERSION) {
      throw new Error(`seed_version_mismatch: reset ${SEED_KEY} before changing the seed profile.`);
    }
    const startAt = Date.parse(toIso(marker.started_at));
    const endAt = Date.parse(toIso(marker.ended_at));
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
      throw new Error('demo_seed_run_has_invalid_time_window');
    }
    return { startAt, endAt, expected: toCount(marker.expected_records) };
  }

  const endAt = Math.floor(Date.now() / 1_000) * 1_000;
  const startAt = endAt - HISTORY_DAYS * DAY_MS;
  const expected = createProfiles(startAt, endAt)
    .reduce((total, profile) => total + expectedTelemetryCount(profile, startAt, endAt), 0);
  const now = toMySqlDate(Date.now());
  await mysql.execute(
    `INSERT INTO demo_seed_runs (
       seed_key, seed_version, started_at, ended_at, expected_records, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
    [SEED_KEY, SEED_VERSION, toMySqlDate(startAt), toMySqlDate(endAt), expected, now, now],
  );
  return { startAt, endAt, expected };
}

async function upsertInventory(mysql: MySqlAccess, profiles: DemoProfile[], createdAt: number): Promise<void> {
  for (const profile of profiles) {
    const now = toMySqlDate(Date.now());
    await mysql.execute(
      `INSERT INTO zones (code, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), updated_at = VALUES(updated_at)`,
      [profile.zoneCode, profile.zoneName, profile.zoneDescription, toMySqlDate(createdAt), now],
    );
    await mysql.execute(
      `INSERT INTO devices (
         device_id, uuid, name, site, zone, firmware_version,
         axis_label_ax, axis_label_ay, axis_label_az, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), site = VALUES(site), zone = VALUES(zone), firmware_version = VALUES(firmware_version),
         axis_label_ax = VALUES(axis_label_ax), axis_label_ay = VALUES(axis_label_ay), axis_label_az = VALUES(axis_label_az),
         notes = VALUES(notes), updated_at = VALUES(updated_at)`,
      [
        profile.deviceId,
        `${DEMO_PREFIX}-UUID-${profile.deviceId.slice(DEMO_PREFIX.length + 1)}`,
        profile.name,
        profile.site,
        profile.zoneCode,
        'v1.0.12-demo',
        'Truc X',
        'Truc Y',
        'Truc Z',
        'Du lieu mo phong 60 ngay, tao boi seed-demo-2m.',
        toMySqlDate(createdAt),
        now,
      ],
    );
  }
}

async function seedStatusHistory(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<void> {
  for (const profile of profiles) {
    const socketId = `${DEMO_PREFIX}-socket-${profile.deviceId}`;
    // The table has no natural uniqueness constraint for a status window, so
    // replace only this seed's synthetic status rows before recreating them.
    await mysql.execute(
      `DELETE FROM device_status_history
        WHERE device_id = ? AND status = 'offline' AND socket_id = ?`,
      [profile.deviceId, socketId],
    );
    for (const window of profile.offlineWindows) {
      const isCurrentOffline = profile.currentOffline && window.endsAt === Math.max(...profile.offlineWindows.map((item) => item.endsAt));
      await mysql.execute(
        `INSERT INTO device_status_history (
           device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at
         ) VALUES (?, 'offline', ?, ?, ?, ?, ?, ?, ?)`,
        [
          profile.deviceId,
          socketId,
          toMySqlDate(window.startsAt),
          isCurrentOffline ? null : toMySqlDate(window.endsAt),
          toMySqlDate(window.startsAt - 8_000),
          window.reason,
          toMySqlDate(window.startsAt),
          toMySqlDate(isCurrentOffline ? window.startsAt : window.endsAt),
        ],
      );
    }
  }
}

async function insertTelemetryBatch(mysql: MySqlAccess, rows: TelemetryRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const placeholders = rows.map(() => `(${new Array(19).fill('?').join(', ')})`).join(', ');
  const values = rows.flat() as SqlParam[];
  await mysql.execute(
    `INSERT IGNORE INTO device_datas (
       device_id, received_at, temperature, vibration, ax, ay, az,
       vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
       drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit,
       sample_count, telemetry_uuid
     ) VALUES ${placeholders}`,
    values,
  );
}

async function seedTelemetry(
  mysql: MySqlAccess,
  profiles: DemoProfile[],
  startAt: number,
  endAt: number,
  expected: number,
): Promise<void> {
  let insertedCandidates = 0;
  let batch: TelemetryRow[] = [];
  let nextProgress = 100_000;
  const startedAt = Date.now();

  for (const profile of profiles) {
    const intervalRandom = createPrng(hashString(`${SEED_KEY}:${profile.deviceId}`));
    const valueRandom = createPrng(hashString(`${SEED_KEY}:${profile.deviceId}:values`));
    let timestamp = startAt;
    let sequence = 0;
    while (timestamp <= endAt) {
      if (!isSkipped(profile, timestamp)) {
        batch.push(createTelemetryRow(profile, timestamp, sequence, valueRandom));
        insertedCandidates += 1;
      }
      if (batch.length >= BATCH_SIZE) {
        await insertTelemetryBatch(mysql, batch);
        batch = [];
      }
      if (insertedCandidates >= nextProgress) {
        const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1_000);
        console.log(`[seed:demo-2m] ${insertedCandidates.toLocaleString('en-US')}/${expected.toLocaleString('en-US')} candidate rows (${Math.round(insertedCandidates / elapsedSeconds).toLocaleString('en-US')} rows/s)`);
        nextProgress += 100_000;
      }
      timestamp += (5 + Math.floor(intervalRandom() * 6)) * 1_000;
      sequence += 1;
    }
  }
  await insertTelemetryBatch(mysql, batch);
}

function createSpectrumMessage(
  deviceId: string,
  timestamp: string,
  telemetryUuid: string,
  axis: 'x' | 'y' | 'z',
): TelemetrySpectrumMessage {
  const binCount = 96;
  const peakIndex = axis === 'x' ? 17 : axis === 'y' ? 29 : 41;
  const amplitudes = Array.from({ length: binCount }, (_, index) => {
    const distance = Math.abs(index - peakIndex);
    return round(0.018 + Math.exp(-(distance ** 2) / 18) * (axis === 'y' ? 0.24 : 0.17), 6);
  });
  return {
    deviceId,
    receivedAt: timestamp,
    axis,
    telemetryUuid,
    uuid: `${DEMO_PREFIX}-SPECTRUM-${deviceId}`,
    sourceSampleCount: 1024,
    sampleRateHz: 1_000,
    binCount,
    binHz: 1_000 / 1_024,
    magnitudeUnit: 'm/s2 RMS',
    amplitudes,
    peakBinIndex: peakIndex,
    peakFrequencyHz: round((peakIndex + 1) * (1_000 / 1_024), 6),
    peakAmplitude: amplitudes[peakIndex],
  };
}

async function seedSparseSpectrum(mysql: MySqlAccess, profiles: DemoProfile[], startAt: number): Promise<void> {
  const storage = new SpectrumStorageService(mysql, {
    baseDir: process.env.SPECTRUM_STORAGE_DIR ?? 'storage/spectrum',
    frameFlushMs: 1,
  });
  for (const profile of profiles) {
    for (const day of SPECTRUM_FRAME_DAYS) {
      const targetAt = toMySqlDate(startAt + day * DAY_MS);
      const rows = await mysql.query<TelemetryReferenceRow>(
        `SELECT received_at, telemetry_uuid
           FROM device_datas
          WHERE device_id = ? AND received_at >= ?
          ORDER BY received_at ASC
          LIMIT 1`,
        [profile.deviceId, targetAt],
      );
      const reference = rows[0];
      if (!reference?.telemetry_uuid) {
        continue;
      }
      const existingFrame = await mysql.query<CountRow>(
        `SELECT COUNT(*) AS total
           FROM device_spectrum_frames
          WHERE device_id = ? AND telemetry_uuid = ?`,
        [profile.deviceId, reference.telemetry_uuid],
      );
      if (toCount(existingFrame[0]?.total) > 0) {
        continue;
      }
      const receivedAt = toIso(reference.received_at);
      await Promise.all((['x', 'y', 'z'] as const).map((axis) =>
        storage.ingest(createSpectrumMessage(profile.deviceId, receivedAt, reference.telemetry_uuid, axis)),
      ));
    }
  }
}

async function countDemoTelemetry(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<number> {
  const placeholders = profiles.map(() => '?').join(', ');
  const rows = await mysql.query<CountRow>(
    `SELECT COUNT(*) AS total
       FROM device_datas
      WHERE device_id IN (${placeholders})
        AND telemetry_uuid LIKE ?`,
    [...profiles.map((profile) => profile.deviceId), `${DEMO_PREFIX}:%`],
  );
  return toCount(rows[0]?.total);
}

async function isHourlyAvailabilityCurrent(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<boolean> {
  const deviceIds = profiles.map((profile) => profile.deviceId);
  const placeholders = deviceIds.map(() => '?').join(', ');
  const [rawRows, summaryRows, metricRows] = await Promise.all([
    mysql.query<CountRow>(
      `SELECT COUNT(*) AS total FROM device_datas WHERE device_id IN (${placeholders})`,
      deviceIds,
    ),
    mysql.query<CountRow>(
      `SELECT COALESCE(SUM(sample_count), 0) AS total
         FROM device_telemetry_hour_summaries
        WHERE device_id IN (${placeholders})`,
      deviceIds,
    ),
    mysql.query<CountRow>(
      `SELECT COALESCE(SUM(sample_count), 0) AS total
         FROM device_telemetry_hour_metric_summaries
        WHERE device_id IN (${placeholders})`,
      deviceIds,
    ),
  ]);
  const rawCount = toCount(rawRows[0]?.total);
  return rawCount === toCount(summaryRows[0]?.total) && rawCount === toCount(metricRows[0]?.total);
}

async function refreshHourlyAvailability(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<void> {
  const deviceIds = profiles.map((profile) => profile.deviceId);
  const placeholders = deviceIds.map(() => '?').join(', ');
  await mysql.execute(
    `INSERT INTO device_telemetry_hour_metric_summaries (
       device_id, hour_started_at, sample_count, first_received_at, last_received_at,
       temperature, vibration, ax, ay, az,
       vrms_x_mms, vrms_y_mms, vrms_z_mms, vrms_unit,
       drms_x_um, drms_y_um, drms_z_um, drms_band_min_hz, drms_band_max_hz, drms_unit
     )
     SELECT
       device_id,
       DATE_FORMAT(received_at, '%Y-%m-%d %H:00:00'),
       COUNT(*),
       MIN(received_at),
       MAX(received_at),
       AVG(temperature), AVG(vibration), AVG(ax), AVG(ay), AVG(az),
       AVG(vrms_x_mms), AVG(vrms_y_mms), AVG(vrms_z_mms), MAX(vrms_unit),
       AVG(drms_x_um), AVG(drms_y_um), AVG(drms_z_um), AVG(drms_band_min_hz), AVG(drms_band_max_hz), MAX(drms_unit)
     FROM device_datas
     WHERE device_id IN (${placeholders})
     GROUP BY device_id, DATE_FORMAT(received_at, '%Y-%m-%d %H:00:00')
     ON DUPLICATE KEY UPDATE
       sample_count = VALUES(sample_count),
       first_received_at = VALUES(first_received_at),
       last_received_at = VALUES(last_received_at),
       temperature = VALUES(temperature), vibration = VALUES(vibration), ax = VALUES(ax), ay = VALUES(ay), az = VALUES(az),
       vrms_x_mms = VALUES(vrms_x_mms), vrms_y_mms = VALUES(vrms_y_mms), vrms_z_mms = VALUES(vrms_z_mms), vrms_unit = VALUES(vrms_unit),
       drms_x_um = VALUES(drms_x_um), drms_y_um = VALUES(drms_y_um), drms_z_um = VALUES(drms_z_um),
       drms_band_min_hz = VALUES(drms_band_min_hz), drms_band_max_hz = VALUES(drms_band_max_hz), drms_unit = VALUES(drms_unit)`,
    deviceIds,
  );
  await mysql.execute(
    `INSERT INTO device_telemetry_hour_summaries (
       device_id, hour_started_at, sample_count, first_received_at, last_received_at
     )
     SELECT device_id, hour_started_at, sample_count, first_received_at, last_received_at
       FROM device_telemetry_hour_metric_summaries
      WHERE device_id IN (${placeholders})
     ON DUPLICATE KEY UPDATE
       sample_count = VALUES(sample_count),
       first_received_at = VALUES(first_received_at),
       last_received_at = VALUES(last_received_at)`,
    deviceIds,
  );
}

async function collectCadenceSamples(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<CadenceRow> {
  let minSeconds = Number.POSITIVE_INFINITY;
  let maxSeconds = 0;
  let violations = 0;
  for (const profile of profiles) {
    // A bounded contiguous slice proves the persisted write cadence without a
    // multi-minute window scan across all four million rows.
    const rows = await mysql.query<CadenceRow>(`
      SELECT
        MIN(delta_seconds) AS min_seconds,
        MAX(delta_seconds) AS max_seconds,
        SUM(CASE WHEN delta_seconds > 10 AND delta_seconds < 60 THEN 1 ELSE 0 END) AS violations
      FROM (
        SELECT TIMESTAMPDIFF(
          SECOND,
          LAG(received_at) OVER (ORDER BY received_at),
          received_at
        ) AS delta_seconds
        FROM (
          SELECT received_at
          FROM device_datas
          WHERE device_id = ? AND telemetry_uuid LIKE ?
          ORDER BY received_at DESC
          LIMIT 12000
        ) AS recent_samples
      ) AS telemetry_steps
      WHERE delta_seconds IS NOT NULL
    `, [profile.deviceId, `${DEMO_PREFIX}:%`]);
    const row = rows[0];
    minSeconds = Math.min(minSeconds, toCount(row?.min_seconds));
    maxSeconds = Math.max(maxSeconds, toCount(row?.max_seconds));
    violations += toCount(row?.violations);
  }
  return {
    min_seconds: Number.isFinite(minSeconds) ? minSeconds : 0,
    max_seconds: maxSeconds,
    violations,
  };
}

async function verifyNoDataWindows(mysql: MySqlAccess, profiles: DemoProfile[]): Promise<number> {
  let largestGapSeconds = 0;
  for (const profile of profiles) {
    for (const window of profile.noDataWindows) {
      const rows = await mysql.query<CountRow>(
        `SELECT COUNT(*) AS total
           FROM device_datas
          WHERE device_id = ? AND received_at >= ? AND received_at < ?`,
        [profile.deviceId, toMySqlDate(window.startsAt), toMySqlDate(window.endsAt)],
      );
      if (toCount(rows[0]?.total) !== 0) {
        throw new Error(`no_data_window_contains_telemetry:${profile.deviceId}:${window.reason}`);
      }
      largestGapSeconds = Math.max(largestGapSeconds, Math.round((window.endsAt - window.startsAt) / 1_000));
    }
  }
  return largestGapSeconds;
}

async function collectSummary(mysql: MySqlAccess, profiles: DemoProfile[], startAt: number, endAt: number, expected: number): Promise<DemoSummary> {
  const zonePlaceholders = profiles.map(() => '?').join(', ');
  const devicePlaceholders = profiles.map(() => '?').join(', ');
  const [zoneRows, deviceRows, offlineRows, currentOfflineRows, spectrumRows, databaseRows, coverageRows] = await Promise.all([
    mysql.query<CountRow>(`SELECT COUNT(*) AS total FROM zones WHERE code IN (${zonePlaceholders})`, profiles.map((profile) => profile.zoneCode)),
    mysql.query<CountRow>(`SELECT COUNT(*) AS total FROM devices WHERE device_id IN (${devicePlaceholders})`, profiles.map((profile) => profile.deviceId)),
    mysql.query<CountRow>(
      `SELECT COUNT(*) AS total
         FROM device_status_history
        WHERE device_id IN (${devicePlaceholders})
          AND status = 'offline'
          AND socket_id IN (${devicePlaceholders})`,
      [...profiles.map((profile) => profile.deviceId), ...profiles.map((profile) => `${DEMO_PREFIX}-socket-${profile.deviceId}`)],
    ),
    mysql.query<CountRow>(
      `SELECT COUNT(*) AS total
         FROM device_status_history
        WHERE device_id IN (${devicePlaceholders})
          AND status = 'offline'
          AND ended_at IS NULL
          AND socket_id IN (${devicePlaceholders})`,
      [...profiles.map((profile) => profile.deviceId), ...profiles.map((profile) => `${DEMO_PREFIX}-socket-${profile.deviceId}`)],
    ),
    mysql.query<CountRow>(`SELECT COUNT(*) AS total FROM device_spectrum_frames WHERE device_id IN (${devicePlaceholders})`, profiles.map((profile) => profile.deviceId)),
    mysql.query<DbSizeRow>(`
      SELECT DATABASE() AS database_name,
             COALESCE(SUM(data_length + index_length), 0) AS bytes
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
    `),
    mysql.query<CoverageRow>(`
      SELECT MIN(received_at) AS first_at, MAX(received_at) AS last_at
      FROM device_datas
      WHERE device_id IN (${devicePlaceholders}) AND telemetry_uuid LIKE ?
    `, [...profiles.map((profile) => profile.deviceId), `${DEMO_PREFIX}:%`]),
  ]);
  const [cadence, noDataGapSeconds] = await Promise.all([
    collectCadenceSamples(mysql, profiles),
    verifyNoDataWindows(mysql, profiles),
  ]);
  const actualTelemetryRecords = await countDemoTelemetry(mysql, profiles);
  const firstTelemetryRaw = coverageRows[0]?.first_at;
  const lastTelemetryRaw = coverageRows[0]?.last_at;
  return {
    database: databaseRows[0]?.database_name ?? null,
    startAt: toIso(startAt),
    endAt: toIso(endAt),
    expectedTelemetryRecords: expected,
    actualTelemetryRecords,
    demoZones: toCount(zoneRows[0]?.total),
    demoDevices: toCount(deviceRows[0]?.total),
    offlineIntervals: toCount(offlineRows[0]?.total),
    currentOfflineIntervals: toCount(currentOfflineRows[0]?.total),
    cadenceMinSeconds: toCount(cadence.min_seconds),
    cadenceMaxSeconds: toCount(cadence.max_seconds),
    cadenceViolations: toCount(cadence.violations),
    noDataGapSeconds,
    firstTelemetryAt: firstTelemetryRaw ? toIso(firstTelemetryRaw) : null,
    lastTelemetryAt: lastTelemetryRaw ? toIso(lastTelemetryRaw) : null,
    spectrumFrames: toCount(spectrumRows[0]?.total),
    databaseBytes: toCount(databaseRows[0]?.bytes),
  };
}

async function markSeedCompleted(mysql: MySqlAccess): Promise<void> {
  await mysql.execute(
    `UPDATE demo_seed_runs SET status = 'completed', updated_at = ? WHERE seed_key = ?`,
    [toMySqlDate(Date.now()), SEED_KEY],
  );
}

async function resetDemo(mysql: MySqlAccess): Promise<void> {
  const profiles = createProfiles(0, DAY_MS);
  const deviceIds = profiles.map((profile) => profile.deviceId);
  const zoneCodes = profiles.map((profile) => profile.zoneCode);
  const devicePlaceholders = deviceIds.map(() => '?').join(', ');
  const zonePlaceholders = zoneCodes.map(() => '?').join(', ');

  await mysql.execute(`DELETE FROM device_spectrum_frames WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM device_telemetry_hour_metric_summaries WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM device_telemetry_hour_summaries WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM device_datas WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM socket_datas WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM device_status_history WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM devices WHERE device_id IN (${devicePlaceholders})`, deviceIds);
  await mysql.execute(`DELETE FROM zones WHERE code IN (${zonePlaceholders})`, zoneCodes);
  await mysql.execute('DELETE FROM demo_seed_runs WHERE seed_key = ?', [SEED_KEY]);

  const spectrumRoot = resolve(serverRoot, process.env.SPECTRUM_STORAGE_DIR ?? 'storage/spectrum');
  for (const deviceId of deviceIds) {
    await rm(join(spectrumRoot, deviceId), { recursive: true, force: true });
  }
  console.log(`[seed:demo-2m] Reset ${deviceIds.length} demo devices and their dependent telemetry.`);
}

function createLiveTelemetry(profile: DemoProfile, sequence: number, random: () => number): Record<string, unknown> {
  const row = createTelemetryRow(profile, Date.now(), sequence, random);
  return {
    telemetry_uuid: `${DEMO_PREFIX}-LIVE:${profile.deviceId}:${Date.now()}`,
    temperature: row[2],
    vibration: row[3],
    ax: row[4],
    ay: row[5],
    az: row[6],
    vx_rms_mms: row[7],
    vy_rms_mms: row[8],
    vz_rms_mms: row[9],
    vrms_unit: row[10],
    drms_x_um: row[11],
    drms_y_um: row[12],
    drms_z_um: row[13],
    drms_band_min_hz: row[14],
    drms_band_max_hz: row[15],
    drms_unit: row[16],
    sample_count: row[17],
  };
}

async function runLiveSimulator(profiles: DemoProfile[]): Promise<void> {
  const serverUrl = process.env.DEMO_LIVE_URL ?? 'http://127.0.0.1:8080';
  const activeProfiles = profiles.filter((profile) => !profile.currentOffline);
  const sockets: Socket[] = [];
  console.log(`[seed:demo-2m] Starting ${activeProfiles.length} live demo devices against ${serverUrl}. Press Ctrl+C to stop.`);

  for (const profile of activeProfiles) {
    const random = createPrng(hashString(`${SEED_KEY}:live:${profile.deviceId}`));
    let sequence = 0;
    const socket = io(serverUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: {
        clientType: 'device',
        deviceId: profile.deviceId,
        token: process.env.DEVICE_AUTH_TOKEN,
      },
      reconnection: true,
    });
    sockets.push(socket);
    socket.on('connect', () => {
      socket.emit('device:metadata', {
        uuid: `${DEMO_PREFIX}-UUID-${profile.deviceId.slice(DEMO_PREFIX.length + 1)}`,
        name: profile.name,
        site: profile.site,
        zone: profile.zoneCode,
        firmwareVersion: 'v1.0.12-demo',
      });
      const emitNext = () => {
        if (!socket.connected) {
          return;
        }
        socket.emit('device:heartbeat', {
          socketConnected: true,
          staConnected: true,
          signal: profile.currentSignal,
          uptimeSec: HISTORY_DAYS * 86_400 + sequence * 8,
        });
        socket.emit('device:telemetry', createLiveTelemetry(profile, sequence, random));
        sequence += 1;
        setTimeout(emitNext, (5 + Math.floor(random() * 6)) * 1_000);
      };
      emitNext();
    });
    socket.on('connect_error', (error) => {
      console.error(`[seed:demo-2m] Live connection failed for ${profile.deviceId}: ${error.message}`);
    });
  }

  const shutdown = () => {
    for (const socket of sockets) {
      socket.disconnect();
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise<void>(() => undefined);
}

async function main(): Promise<void> {
  const runStartedAt = Date.now();
  const resetOnly = process.argv.includes('--reset');
  const live = process.argv.includes('--live');
  const config = resolveMySqlConnectionSettings();
  if (!config) {
    throw new Error('mysql_not_configured: set MYSQL_URL or MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE in server/.env');
  }

  const mysql = new MySqlAccess(config);
  try {
    await mysql.ensureReady();
    await createSeedMetadataTable(mysql);
    await ensureHourlyMetricSummariesTable(mysql);
    if (resetOnly) {
      await resetDemo(mysql);
      return;
    }

    const { startAt, endAt, expected } = await loadOrCreateSeedWindow(mysql);
    const profiles = createProfiles(startAt, endAt);
    console.log(`[seed:demo-2m] Target database is connected. Window: ${toIso(startAt)} to ${toIso(endAt)}.`);
    console.log(`[seed:demo-2m] Expected telemetry records: ${expected.toLocaleString('en-US')}.`);
    await upsertInventory(mysql, profiles, startAt - 30 * DAY_MS);
    await seedStatusHistory(mysql, profiles);

    const existingCount = await countDemoTelemetry(mysql, profiles);
    if (existingCount !== expected) {
      await seedTelemetry(mysql, profiles, startAt, endAt, expected);
    } else {
      console.log('[seed:demo-2m] Telemetry is already complete; skipping duplicate inserts.');
    }

    if (await isHourlyAvailabilityCurrent(mysql, profiles)) {
      console.log('[seed:demo-2m] Hourly availability is current; skipping aggregate rebuild.');
    } else {
      await refreshHourlyAvailability(mysql, profiles);
    }
    await seedSparseSpectrum(mysql, profiles, startAt);
    const summary = await collectSummary(mysql, profiles, startAt, endAt, expected);
    const expectedOfflineIntervals = profiles.reduce((total, profile) => total + profile.offlineWindows.length, 0);
    const expectedCurrentOfflineIntervals = profiles.filter((profile) => profile.currentOffline).length;
    if (
      summary.demoZones !== 6 ||
      summary.demoDevices !== 6 ||
      summary.actualTelemetryRecords !== expected ||
      summary.offlineIntervals !== expectedOfflineIntervals ||
      summary.currentOfflineIntervals !== expectedCurrentOfflineIntervals ||
      summary.cadenceMinSeconds < 5 ||
      summary.cadenceMaxSeconds > 10 ||
      summary.cadenceViolations !== 0 ||
      summary.noDataGapSeconds < 45 * 60 ||
      !summary.firstTelemetryAt ||
      !summary.lastTelemetryAt ||
      Math.abs(Date.parse(summary.firstTelemetryAt) - startAt) > 10_000 ||
      endAt - Date.parse(summary.lastTelemetryAt) > 10_000 ||
      summary.spectrumFrames !== profiles.length * SPECTRUM_FRAME_DAYS.length
    ) {
      throw new Error(`demo_seed_verification_failed: ${JSON.stringify(summary)}`);
    }
    await markSeedCompleted(mysql);
    console.log(`[seed:demo-2m] Completed in ${Math.round((Date.now() - runStartedAt) / 1_000)}s: ${JSON.stringify(summary)}`);
    if (live) {
      await runLiveSimulator(profiles);
    }
  } finally {
    if (!live) {
      await mysql.close();
    }
  }
}

main().catch((error) => {
  console.error('[seed:demo-2m] failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
