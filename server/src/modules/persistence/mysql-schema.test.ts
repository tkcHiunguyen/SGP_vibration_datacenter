import assert from 'node:assert/strict';
import test from 'node:test';
import { MYSQL_SCHEMA_SQL } from './mysql-schema.js';

const telemetryColumns = [
  'vrms_x_mms',
  'vrms_y_mms',
  'vrms_z_mms',
  'vrms_unit',
  'drms_x_um',
  'drms_y_um',
  'drms_z_um',
  'drms_band_min_hz',
  'drms_band_max_hz',
  'drms_unit',
];

const exportJobColumns = [
  'job_id',
  'status',
  'progress',
  'stage',
  'date_from',
  'date_to',
  'device_id',
  'created_by',
  'worker_run_id',
  'file_name',
  'file_path',
  'size_bytes',
  'manifest_json',
  'error',
  'created_at',
  'started_at',
  'completed_at',
  'expires_at',
  'updated_at',
];

test('runtime MySQL schema includes derived telemetry columns', () => {
  for (const column of telemetryColumns) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`column_name = '${column}'`, 'i'));
  }
});

test('runtime MySQL schema includes data export job table', () => {
  assert.match(MYSQL_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS data_export_jobs/i);
  for (const column of exportJobColumns) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
});
