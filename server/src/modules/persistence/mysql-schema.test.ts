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

const importJobColumns = [
  'job_id',
  'upload_id',
  'status',
  'stage',
  'progress',
  'stage_progress',
  'file_name',
  'file_path',
  'file_sha256',
  'size_bytes',
  'mode',
  'total_measurements',
  'processed_measurements',
  'inserted_count',
  'updated_count',
  'skipped_count',
  'failed_count',
  'records_per_second',
  'estimated_seconds_remaining',
  'checkpoint_json',
  'expires_at',
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

test('runtime MySQL schema includes persistent data import jobs', () => {
  assert.match(MYSQL_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS data_import_jobs/i);
  for (const column of importJobColumns) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
});

test('runtime MySQL schema includes hourly telemetry availability summaries', () => {
  assert.match(MYSQL_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS device_telemetry_hour_summaries/i);
  for (const column of ['device_id', 'hour_started_at', 'sample_count', 'first_received_at', 'last_received_at']) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
});

test('runtime MySQL schema backfills hourly availability once during deployment', () => {
  assert.match(MYSQL_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS app_schema_migrations/i);
  assert.match(MYSQL_SCHEMA_SQL, /20260718_backfill_hourly_telemetry_availability_v1/i);
  assert.match(
    MYSQL_SCHEMA_SQL,
    /INSERT INTO device_telemetry_hour_summaries[\s\S]*SELECT device_id, DATE_FORMAT\(received_at/i,
  );
});

test('runtime MySQL schema includes hourly telemetry metric summaries', () => {
  assert.match(MYSQL_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS device_telemetry_hour_metric_summaries/i);
  for (const column of ['temperature', 'vibration', 'vrms_x_mms', 'drms_x_um']) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
});

test('runtime MySQL schema includes ADXL health and partial telemetry fields', () => {
  for (const column of [
    'adxl_status',
    'adxl_fault_reason',
    'adxl_status_updated_at',
    'adxl_capture_timeout_count',
    'adxl_i2c_read_error_count',
    'message_id',
    'temperature_available',
    'vibration_available',
  ]) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
  assert.match(MYSQL_SCHEMA_SQL, /uq_device_datas_device_message_id/i);
});

test('runtime MySQL schema keeps separate metric sample counts for partial telemetry', () => {
  for (const column of ['temperature_sample_count', 'vibration_sample_count', 'ax_sample_count']) {
    assert.match(MYSQL_SCHEMA_SQL, new RegExp(`\\b${column}\\b`));
  }
});
