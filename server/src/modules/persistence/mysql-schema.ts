export const MYSQL_SCHEMA_SQL = `
-- Legacy rename: device_metadata -> devices
SET @has_legacy_device_metadata := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_metadata'
);
SET @has_devices := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'devices'
);
SET @rename_devices_sql := IF(
  @has_legacy_device_metadata = 1 AND @has_devices = 0,
  'RENAME TABLE device_metadata TO devices',
  'SELECT 1'
);
PREPARE rename_devices_stmt FROM @rename_devices_sql;
EXECUTE rename_devices_stmt;
DEALLOCATE PREPARE rename_devices_stmt;

-- Legacy rename: device_sessions -> socket_datas
SET @has_legacy_device_sessions := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_sessions'
);
SET @has_socket_datas := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas'
);
SET @rename_socket_datas_sql := IF(
  @has_legacy_device_sessions = 1 AND @has_socket_datas = 0,
  'RENAME TABLE device_sessions TO socket_datas',
  'SELECT 1'
);
PREPARE rename_socket_datas_stmt FROM @rename_socket_datas_sql;
EXECUTE rename_socket_datas_stmt;
DEALLOCATE PREPARE rename_socket_datas_stmt;

-- Legacy rename: socket_disconnect_events -> device_history_connection
SET @has_socket_disconnect_events := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'socket_disconnect_events'
);
SET @has_device_history_connection := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_history_connection'
);
SET @rename_device_history_connection_sql := IF(
  @has_socket_disconnect_events = 1 AND @has_device_history_connection = 0,
  'RENAME TABLE socket_disconnect_events TO device_history_connection',
  'SELECT 1'
);
PREPARE rename_device_history_connection_stmt FROM @rename_device_history_connection_sql;
EXECUTE rename_device_history_connection_stmt;
DEALLOCATE PREPARE rename_device_history_connection_stmt;

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(191) NOT NULL,
  uuid VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  site VARCHAR(128) NULL,
  zone VARCHAR(64) NULL,
  firmware_version VARCHAR(128) NULL,
  axis_label_ax VARCHAR(64) NULL,
  axis_label_ay VARCHAR(64) NULL,
  axis_label_az VARCHAR(64) NULL,
  notes TEXT NULL,
  adxl_status VARCHAR(16) NULL,
  adxl_fault_reason VARCHAR(32) NULL,
  adxl_status_updated_at DATETIME(3) NULL,
  adxl_capture_timeout_count INT UNSIGNED NULL,
  adxl_i2c_read_error_count INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_device_id (device_id),
  UNIQUE KEY uq_devices_uuid (uuid),
  KEY idx_devices_site (site),
  KEY idx_devices_zone (zone)
);

CREATE TABLE IF NOT EXISTS zones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_zones_code (code),
  KEY idx_zones_name (name)
);

CREATE TABLE IF NOT EXISTS socket_datas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(191) NOT NULL,
  socket_id VARCHAR(191) NOT NULL,
  connected_at DATETIME(3) NOT NULL,
  last_heartbeat_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_socket_datas_device_id (device_id),
  KEY idx_socket_datas_connected_at (connected_at),
  CONSTRAINT fk_socket_datas_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_runtime_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(191) NOT NULL,
  service_name VARCHAR(191) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  last_heartbeat_at DATETIME(3) NOT NULL,
  stopped_at DATETIME(3) NULL,
  stop_reason VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_server_runtime_history_run_id (run_id),
  KEY idx_server_runtime_history_service_started (service_name, started_at),
  KEY idx_server_runtime_history_service_stopped (service_name, stopped_at)
);

CREATE TABLE IF NOT EXISTS device_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  socket_id VARCHAR(191) NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  last_heartbeat_at DATETIME(3) NULL,
  reason VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_status_history_interval (device_id, status, socket_id, started_at),
  KEY idx_device_status_history_device_started (device_id, started_at),
  KEY idx_device_status_history_device_open (device_id, ended_at),
  KEY idx_device_status_history_status_started (status, started_at),
  CONSTRAINT fk_device_status_history_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

SET @has_device_history_connection_for_migration := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_history_connection'
);
SET @migrate_device_history_connection_online_sql := IF(
  @has_device_history_connection_for_migration = 1,
  'INSERT IGNORE INTO device_status_history (device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at) SELECT device_id, ''online'', socket_id, connected_at, disconnected_at, last_heartbeat_at, NULL, connected_at, disconnected_at FROM device_history_connection',
  'SELECT 1'
);
PREPARE migrate_device_history_connection_online_stmt FROM @migrate_device_history_connection_online_sql;
EXECUTE migrate_device_history_connection_online_stmt;
DEALLOCATE PREPARE migrate_device_history_connection_online_stmt;
SET @migrate_device_history_connection_offline_sql := IF(
  @has_device_history_connection_for_migration = 1,
  'INSERT IGNORE INTO device_status_history (device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at) SELECT event.device_id, ''offline'', event.socket_id, event.disconnected_at, (SELECT MIN(next_event.connected_at) FROM device_history_connection next_event WHERE next_event.device_id = event.device_id AND next_event.connected_at > event.disconnected_at), event.last_heartbeat_at, event.disconnect_reason, event.disconnected_at, COALESCE((SELECT MIN(next_event.connected_at) FROM device_history_connection next_event WHERE next_event.device_id = event.device_id AND next_event.connected_at > event.disconnected_at), event.disconnected_at) FROM device_history_connection event',
  'SELECT 1'
);
PREPARE migrate_device_history_connection_offline_stmt FROM @migrate_device_history_connection_offline_sql;
EXECUTE migrate_device_history_connection_offline_stmt;
DEALLOCATE PREPARE migrate_device_history_connection_offline_stmt;
DROP TABLE IF EXISTS device_history_connection;

SET @has_socket_disconnect_events_for_migration := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'socket_disconnect_events'
);
SET @migrate_socket_disconnect_events_online_sql := IF(
  @has_socket_disconnect_events_for_migration = 1,
  'INSERT IGNORE INTO device_status_history (device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at) SELECT device_id, ''online'', socket_id, connected_at, disconnected_at, last_heartbeat_at, NULL, connected_at, disconnected_at FROM socket_disconnect_events',
  'SELECT 1'
);
PREPARE migrate_socket_disconnect_events_online_stmt FROM @migrate_socket_disconnect_events_online_sql;
EXECUTE migrate_socket_disconnect_events_online_stmt;
DEALLOCATE PREPARE migrate_socket_disconnect_events_online_stmt;
SET @migrate_socket_disconnect_events_offline_sql := IF(
  @has_socket_disconnect_events_for_migration = 1,
  'INSERT IGNORE INTO device_status_history (device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at) SELECT event.device_id, ''offline'', event.socket_id, event.disconnected_at, (SELECT MIN(next_event.connected_at) FROM socket_disconnect_events next_event WHERE next_event.device_id = event.device_id AND next_event.connected_at > event.disconnected_at), event.last_heartbeat_at, event.disconnect_reason, event.disconnected_at, COALESCE((SELECT MIN(next_event.connected_at) FROM socket_disconnect_events next_event WHERE next_event.device_id = event.device_id AND next_event.connected_at > event.disconnected_at), event.disconnected_at) FROM socket_disconnect_events event',
  'SELECT 1'
);
PREPARE migrate_socket_disconnect_events_offline_stmt FROM @migrate_socket_disconnect_events_offline_sql;
EXECUTE migrate_socket_disconnect_events_offline_stmt;
DEALLOCATE PREPARE migrate_socket_disconnect_events_offline_stmt;
DROP TABLE IF EXISTS socket_disconnect_events;

UPDATE device_status_history h
JOIN socket_datas sd ON sd.device_id = h.device_id
SET
  h.ended_at = sd.connected_at,
  h.updated_at = sd.connected_at
WHERE h.ended_at IS NULL AND h.started_at < sd.connected_at;

INSERT IGNORE INTO device_status_history (
  device_id, status, socket_id, started_at, ended_at, last_heartbeat_at, reason, created_at, updated_at
)
SELECT
  device_id, 'online', socket_id, connected_at, NULL, last_heartbeat_at, NULL, connected_at, connected_at
FROM socket_datas;

-- Enforce numeric surrogate key on devices while keeping business key device_id.
SET @has_devices_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'id'
);
SET @add_devices_id_sql := IF(
  @has_devices_id = 0,
  'ALTER TABLE devices ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST',
  'SELECT 1'
);
PREPARE add_devices_id_stmt FROM @add_devices_id_sql;
EXECUTE add_devices_id_stmt;
DEALLOCATE PREPARE add_devices_id_stmt;

UPDATE devices
SET uuid = UUID()
WHERE uuid IS NULL OR TRIM(uuid) = '';

SET @devices_uuid_not_null := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'devices'
    AND column_name = 'uuid'
    AND is_nullable = 'NO'
);
SET @enforce_devices_uuid_not_null_sql := IF(
  @devices_uuid_not_null = 0,
  'ALTER TABLE devices MODIFY COLUMN uuid VARCHAR(255) NOT NULL',
  'SELECT 1'
);
PREPARE enforce_devices_uuid_not_null_stmt FROM @enforce_devices_uuid_not_null_sql;
EXECUTE enforce_devices_uuid_not_null_stmt;
DEALLOCATE PREPARE enforce_devices_uuid_not_null_stmt;

SET @add_devices_adxl_columns_sql := (
  SELECT COALESCE(
    CONCAT('ALTER TABLE devices ', GROUP_CONCAT(CONCAT('ADD COLUMN ', column_definition) ORDER BY column_name SEPARATOR ', ')),
    'SELECT 1'
  )
  FROM (
    SELECT 'adxl_status' AS column_name, 'adxl_status VARCHAR(16) NULL' AS column_definition
    UNION ALL SELECT 'adxl_fault_reason', 'adxl_fault_reason VARCHAR(32) NULL'
    UNION ALL SELECT 'adxl_status_updated_at', 'adxl_status_updated_at DATETIME(3) NULL'
    UNION ALL SELECT 'adxl_capture_timeout_count', 'adxl_capture_timeout_count INT UNSIGNED NULL'
    UNION ALL SELECT 'adxl_i2c_read_error_count', 'adxl_i2c_read_error_count INT UNSIGNED NULL'
  ) AS required_columns
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'devices'
      AND column_name = required_columns.column_name
  )
);
PREPARE add_devices_adxl_columns_stmt FROM @add_devices_adxl_columns_sql;
EXECUTE add_devices_adxl_columns_stmt;
DEALLOCATE PREPARE add_devices_adxl_columns_stmt;

SET @has_uq_devices_device_id := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'devices'
    AND index_name = 'uq_devices_device_id'
);
SET @add_uq_devices_device_id_sql := IF(
  @has_uq_devices_device_id = 0,
  'ALTER TABLE devices ADD UNIQUE KEY uq_devices_device_id (device_id)',
  'SELECT 1'
);
PREPARE add_uq_devices_device_id_stmt FROM @add_uq_devices_device_id_sql;
EXECUTE add_uq_devices_device_id_stmt;
DEALLOCATE PREPARE add_uq_devices_device_id_stmt;

SET @has_uq_devices_uuid := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'devices'
    AND index_name = 'uq_devices_uuid'
);
SET @add_uq_devices_uuid_sql := IF(
  @has_uq_devices_uuid = 0,
  'ALTER TABLE devices ADD UNIQUE KEY uq_devices_uuid (uuid)',
  'SELECT 1'
);
PREPARE add_uq_devices_uuid_stmt FROM @add_uq_devices_uuid_sql;
EXECUTE add_uq_devices_uuid_stmt;
DEALLOCATE PREPARE add_uq_devices_uuid_stmt;

-- Normalize zone column shape to match zones.code for referential integrity.
SET @has_devices_zone_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'zone'
);
SET @normalize_devices_zone_column_sql := IF(
  @has_devices_zone_column = 1,
  'ALTER TABLE devices MODIFY COLUMN zone VARCHAR(64) NULL',
  'SELECT 1'
);
PREPARE normalize_devices_zone_column_stmt FROM @normalize_devices_zone_column_sql;
EXECUTE normalize_devices_zone_column_stmt;
DEALLOCATE PREPARE normalize_devices_zone_column_stmt;

SET @has_devices_axis_label_ax := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'axis_label_ax'
);
SET @add_devices_axis_label_ax_sql := IF(
  @has_devices_axis_label_ax = 0,
  'ALTER TABLE devices ADD COLUMN axis_label_ax VARCHAR(64) NULL AFTER firmware_version',
  'SELECT 1'
);
PREPARE add_devices_axis_label_ax_stmt FROM @add_devices_axis_label_ax_sql;
EXECUTE add_devices_axis_label_ax_stmt;
DEALLOCATE PREPARE add_devices_axis_label_ax_stmt;

SET @has_devices_axis_label_ay := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'axis_label_ay'
);
SET @add_devices_axis_label_ay_sql := IF(
  @has_devices_axis_label_ay = 0,
  'ALTER TABLE devices ADD COLUMN axis_label_ay VARCHAR(64) NULL AFTER axis_label_ax',
  'SELECT 1'
);
PREPARE add_devices_axis_label_ay_stmt FROM @add_devices_axis_label_ay_sql;
EXECUTE add_devices_axis_label_ay_stmt;
DEALLOCATE PREPARE add_devices_axis_label_ay_stmt;

SET @has_devices_axis_label_az := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'axis_label_az'
);
SET @add_devices_axis_label_az_sql := IF(
  @has_devices_axis_label_az = 0,
  'ALTER TABLE devices ADD COLUMN axis_label_az VARCHAR(64) NULL AFTER axis_label_ay',
  'SELECT 1'
);
PREPARE add_devices_axis_label_az_stmt FROM @add_devices_axis_label_az_sql;
EXECUTE add_devices_axis_label_az_stmt;
DEALLOCATE PREPARE add_devices_axis_label_az_stmt;

SET @has_idx_devices_archived_at := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'devices'
    AND index_name = 'idx_devices_archived_at'
);
SET @drop_idx_devices_archived_at_sql := IF(
  @has_idx_devices_archived_at > 0,
  'ALTER TABLE devices DROP INDEX idx_devices_archived_at',
  'SELECT 1'
);
PREPARE drop_idx_devices_archived_at_stmt FROM @drop_idx_devices_archived_at_sql;
EXECUTE drop_idx_devices_archived_at_stmt;
DEALLOCATE PREPARE drop_idx_devices_archived_at_stmt;

SET @has_devices_archived_at_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'archived_at'
);
SET @drop_devices_archived_at_column_sql := IF(
  @has_devices_archived_at_column > 0,
  'ALTER TABLE devices DROP COLUMN archived_at',
  'SELECT 1'
);
PREPARE drop_devices_archived_at_column_stmt FROM @drop_devices_archived_at_column_sql;
EXECUTE drop_devices_archived_at_column_stmt;
DEALLOCATE PREPARE drop_devices_archived_at_column_stmt;

SET @has_devices_sensor_version_column := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'devices' AND column_name = 'sensor_version'
);
SET @drop_devices_sensor_version_column_sql := IF(
  @has_devices_sensor_version_column > 0,
  'ALTER TABLE devices DROP COLUMN sensor_version',
  'SELECT 1'
);
PREPARE drop_devices_sensor_version_column_stmt FROM @drop_devices_sensor_version_column_sql;
EXECUTE drop_devices_sensor_version_column_stmt;
DEALLOCATE PREPARE drop_devices_sensor_version_column_stmt;

SET @devices_pk_columns := (
  SELECT GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position SEPARATOR ',')
  FROM information_schema.table_constraints t
  JOIN information_schema.key_column_usage k
    ON t.constraint_schema = k.constraint_schema
   AND t.table_name = k.table_name
   AND t.constraint_name = k.constraint_name
  WHERE t.constraint_schema = DATABASE()
    AND t.table_name = 'devices'
    AND t.constraint_type = 'PRIMARY KEY'
);
SET @set_devices_pk_sql := IF(
  @devices_pk_columns IS NULL,
  'ALTER TABLE devices ADD PRIMARY KEY (id)',
  IF(@devices_pk_columns = 'id', 'SELECT 1', 'ALTER TABLE devices DROP PRIMARY KEY, ADD PRIMARY KEY (id)')
);
PREPARE set_devices_pk_stmt FROM @set_devices_pk_sql;
EXECUTE set_devices_pk_stmt;
DEALLOCATE PREPARE set_devices_pk_stmt;

-- Enforce numeric surrogate key on socket_datas while keeping one session row per device.
SET @has_socket_datas_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'id'
);
SET @add_socket_datas_id_sql := IF(
  @has_socket_datas_id = 0,
  'ALTER TABLE socket_datas ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE FIRST',
  'SELECT 1'
);
PREPARE add_socket_datas_id_stmt FROM @add_socket_datas_id_sql;
EXECUTE add_socket_datas_id_stmt;
DEALLOCATE PREPARE add_socket_datas_id_stmt;

SET @has_uq_socket_datas_device_id := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'socket_datas'
    AND index_name = 'uq_socket_datas_device_id'
);
SET @add_uq_socket_datas_device_id_sql := IF(
  @has_uq_socket_datas_device_id = 0,
  'ALTER TABLE socket_datas ADD UNIQUE KEY uq_socket_datas_device_id (device_id)',
  'SELECT 1'
);
PREPARE add_uq_socket_datas_device_id_stmt FROM @add_uq_socket_datas_device_id_sql;
EXECUTE add_uq_socket_datas_device_id_stmt;
DEALLOCATE PREPARE add_uq_socket_datas_device_id_stmt;

SET @socket_datas_pk_columns := (
  SELECT GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position SEPARATOR ',')
  FROM information_schema.table_constraints t
  JOIN information_schema.key_column_usage k
    ON t.constraint_schema = k.constraint_schema
   AND t.table_name = k.table_name
   AND t.constraint_name = k.constraint_name
  WHERE t.constraint_schema = DATABASE()
    AND t.table_name = 'socket_datas'
    AND t.constraint_type = 'PRIMARY KEY'
);
SET @set_socket_datas_pk_sql := IF(
  @socket_datas_pk_columns IS NULL,
  'ALTER TABLE socket_datas ADD PRIMARY KEY (id)',
  IF(
    @socket_datas_pk_columns = 'id',
    'SELECT 1',
    'ALTER TABLE socket_datas DROP PRIMARY KEY, ADD PRIMARY KEY (id)'
  )
);
PREPARE set_socket_datas_pk_stmt FROM @set_socket_datas_pk_sql;
EXECUTE set_socket_datas_pk_stmt;
DEALLOCATE PREPARE set_socket_datas_pk_stmt;

CREATE TABLE IF NOT EXISTS alert_rules (
  rule_id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  threshold DOUBLE NOT NULL,
  severity VARCHAR(64) NOT NULL,
  debounce_count INT NOT NULL,
  cooldown_ms INT NOT NULL,
  suppression_window_ms INT NOT NULL,
  flapping_window_ms INT NOT NULL,
  flapping_threshold INT NOT NULL,
  enabled TINYINT(1) NOT NULL,
  time_window_start_hour INT NULL,
  time_window_end_hour INT NULL,
  time_window_timezone VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id VARCHAR(191) PRIMARY KEY,
  rule_id VARCHAR(191) NOT NULL,
  rule_name VARCHAR(255) NOT NULL,
  device_id VARCHAR(191) NOT NULL,
  metric VARCHAR(64) NOT NULL,
  severity VARCHAR(64) NOT NULL,
  threshold DOUBLE NOT NULL,
  trigger_value DOUBLE NOT NULL,
  last_reading_value DOUBLE NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  suppressed_count INT NOT NULL DEFAULT 0,
  noise_state VARCHAR(64) NOT NULL DEFAULT 'normal',
  last_suppressed_at DATETIME(3) NULL,
  status VARCHAR(64) NOT NULL,
  triggered_at DATETIME(3) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  acknowledged_by VARCHAR(191) NULL,
  acknowledged_note TEXT NULL,
  resolved_at DATETIME(3) NULL,
  resolved_by VARCHAR(191) NULL,
  resolution_note TEXT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_alerts_rule_id (rule_id),
  KEY idx_alerts_device_id (device_id),
  CONSTRAINT fk_alerts_rule
    FOREIGN KEY (rule_id) REFERENCES alert_rules(rule_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  CONSTRAINT fk_alerts_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id VARCHAR(191) PRIMARY KEY,
  action VARCHAR(191) NOT NULL,
  device_id VARCHAR(191) NULL,
  command_id VARCHAR(191) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  result VARCHAR(191) NOT NULL,
  metadata JSON NULL,
  KEY idx_audit_logs_device_id (device_id),
  CONSTRAINT fk_audit_logs_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS device_commands (
  command_id VARCHAR(191) PRIMARY KEY,
  device_id VARCHAR(191) NOT NULL,
  type VARCHAR(64) NOT NULL,
  payload JSON NULL,
  sent_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  timeout_at DATETIME(3) NOT NULL,
  status_updated_at DATETIME(3) NOT NULL,
  acked_at DATETIME(3) NULL,
  timeouted_at DATETIME(3) NULL,
  ack_status VARCHAR(64) NULL,
  ack_detail VARCHAR(256) NULL,
  ack_device_uuid VARCHAR(256) NULL,
  ack_firmware_version VARCHAR(128) NULL,
  ack_history JSON NULL,
  KEY idx_device_commands_device_sent_at (device_id, sent_at),
  KEY idx_device_commands_status_timeout (status, timeout_at),
  CONSTRAINT fk_device_commands_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS data_export_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  progress SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  stage VARCHAR(255) NOT NULL,
  date_from DATETIME(3) NOT NULL,
  date_to DATETIME(3) NOT NULL,
  device_id VARCHAR(191) NULL,
  created_by VARCHAR(191) NULL,
  worker_run_id VARCHAR(191) NULL,
  file_name VARCHAR(255) NULL,
  file_path VARCHAR(1024) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  manifest_json JSON NULL,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_data_export_jobs_job_id (job_id),
  KEY idx_data_export_jobs_status_created (status, created_at),
  KEY idx_data_export_jobs_created_at (created_at),
  KEY idx_data_export_jobs_expires_at (expires_at),
  KEY idx_data_export_jobs_device_created (device_id, created_at),
  CONSTRAINT fk_data_export_jobs_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

-- Legacy table rename: keep old data when upgrading telemetry table name.
SET @has_legacy_telemetry_messages := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'telemetry_messages'
);
SET @has_device_datas := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_datas'
);
SET @rename_legacy_telemetry_messages_sql := IF(
  @has_legacy_telemetry_messages = 1 AND @has_device_datas = 0,
  'RENAME TABLE telemetry_messages TO device_datas',
  'SELECT 1'
);
PREPARE rename_legacy_telemetry_messages_stmt FROM @rename_legacy_telemetry_messages_sql;
EXECUTE rename_legacy_telemetry_messages_stmt;
DEALLOCATE PREPARE rename_legacy_telemetry_messages_stmt;

SET @has_legacy_sensor_readings := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'sensor_readings'
);
SET @has_device_datas_after_legacy := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_datas'
);
SET @rename_legacy_sensor_readings_sql := IF(
  @has_legacy_sensor_readings = 1 AND @has_device_datas_after_legacy = 0,
  'RENAME TABLE sensor_readings TO device_datas',
  'SELECT 1'
);
PREPARE rename_legacy_sensor_readings_stmt FROM @rename_legacy_sensor_readings_sql;
EXECUTE rename_legacy_sensor_readings_stmt;
DEALLOCATE PREPARE rename_legacy_sensor_readings_stmt;

SET @has_legacy_sensor_datas := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'sensor_datas'
);
SET @has_device_datas_after_sensor_datas := (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_name = 'device_datas'
);
SET @rename_legacy_sensor_datas_sql := IF(
  @has_legacy_sensor_datas = 1 AND @has_device_datas_after_sensor_datas = 0,
  'RENAME TABLE sensor_datas TO device_datas',
  'SELECT 1'
);
PREPARE rename_legacy_sensor_datas_stmt FROM @rename_legacy_sensor_datas_sql;
EXECUTE rename_legacy_sensor_datas_stmt;
DEALLOCATE PREPARE rename_legacy_sensor_datas_stmt;

CREATE TABLE IF NOT EXISTS device_datas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(191) NOT NULL,
  received_at DATETIME(3) NOT NULL,
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
  sample_count INT NULL,
  telemetry_uuid VARCHAR(255) NULL,
  message_id VARCHAR(255) NULL,
  temperature_available TINYINT(1) NULL,
  vibration_available TINYINT(1) NULL,
  adxl_status VARCHAR(16) NULL,
  adxl_fault_reason VARCHAR(32) NULL,
  KEY idx_device_datas_device_time (device_id, received_at),
  KEY idx_device_datas_received_at (received_at),
  UNIQUE KEY uq_device_datas_device_telemetry_uuid (device_id, telemetry_uuid),
  UNIQUE KEY uq_device_datas_device_message_id (device_id, message_id),
  CONSTRAINT fk_device_datas_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS device_telemetry_hour_summaries (
  device_id VARCHAR(191) NOT NULL,
  hour_started_at DATETIME NOT NULL,
  sample_count INT UNSIGNED NOT NULL,
  first_received_at DATETIME(3) NOT NULL,
  last_received_at DATETIME(3) NOT NULL,
  PRIMARY KEY (device_id, hour_started_at),
  KEY idx_device_telemetry_hour_summaries_hour (hour_started_at),
  CONSTRAINT fk_device_telemetry_hour_summaries_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

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
  temperature_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  vibration_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  ax_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  ay_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  az_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  vrms_x_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  vrms_y_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  vrms_z_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  drms_x_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  drms_y_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  drms_z_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  drms_band_min_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  drms_band_max_sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, hour_started_at),
  KEY idx_device_telemetry_hour_metric_summaries_hour (hour_started_at),
  CONSTRAINT fk_device_telemetry_hour_metric_summaries_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_spectrum_frames (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(191) NOT NULL,
  device_data_id BIGINT NULL,
  captured_at DATETIME(3) NOT NULL,
  telemetry_uuid VARCHAR(255) NULL,
  storage_path VARCHAR(1024) NOT NULL,
  file_size_bytes BIGINT NULL,
  checksum_sha256 CHAR(64) NULL,
  bin_count INT NOT NULL,
  sample_rate_hz DOUBLE NULL,
  bin_hz DOUBLE NULL,
  magnitude_unit VARCHAR(32) NULL,
  peak_x_freq_hz DOUBLE NULL,
  peak_x_amplitude DOUBLE NULL,
  peak_y_freq_hz DOUBLE NULL,
  peak_y_amplitude DOUBLE NULL,
  peak_z_freq_hz DOUBLE NULL,
  peak_z_amplitude DOUBLE NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_device_spectrum_frames_device_time (device_id, captured_at),
  KEY idx_device_spectrum_frames_device_data_id (device_data_id),
  UNIQUE KEY uq_device_spectrum_frames_device_uuid (device_id, telemetry_uuid),
  CONSTRAINT fk_device_spectrum_frames_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_device_spectrum_frames_device_data
    FOREIGN KEY (device_data_id) REFERENCES device_datas(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

-- Drop non-essential persisted session columns (still available in runtime memory).
SET @has_socket_datas_client_ip := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'client_ip'
);
SET @drop_socket_datas_client_ip_sql := IF(
  @has_socket_datas_client_ip = 1,
  'ALTER TABLE socket_datas DROP COLUMN client_ip',
  'SELECT 1'
);
PREPARE drop_socket_datas_client_ip_stmt FROM @drop_socket_datas_client_ip_sql;
EXECUTE drop_socket_datas_client_ip_stmt;
DEALLOCATE PREPARE drop_socket_datas_client_ip_stmt;

SET @has_socket_datas_socket_connected := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'socket_connected'
);
SET @drop_socket_datas_socket_connected_sql := IF(
  @has_socket_datas_socket_connected = 1,
  'ALTER TABLE socket_datas DROP COLUMN socket_connected',
  'SELECT 1'
);
PREPARE drop_socket_datas_socket_connected_stmt FROM @drop_socket_datas_socket_connected_sql;
EXECUTE drop_socket_datas_socket_connected_stmt;
DEALLOCATE PREPARE drop_socket_datas_socket_connected_stmt;

SET @has_socket_datas_sta_connected := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'sta_connected'
);
SET @drop_socket_datas_sta_connected_sql := IF(
  @has_socket_datas_sta_connected = 1,
  'ALTER TABLE socket_datas DROP COLUMN sta_connected',
  'SELECT 1'
);
PREPARE drop_socket_datas_sta_connected_stmt FROM @drop_socket_datas_sta_connected_sql;
EXECUTE drop_socket_datas_sta_connected_stmt;
DEALLOCATE PREPARE drop_socket_datas_sta_connected_stmt;

SET @has_socket_datas_signal_strength := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'signal_strength'
);
SET @drop_socket_datas_signal_strength_sql := IF(
  @has_socket_datas_signal_strength = 1,
  'ALTER TABLE socket_datas DROP COLUMN signal_strength',
  'SELECT 1'
);
PREPARE drop_socket_datas_signal_strength_stmt FROM @drop_socket_datas_signal_strength_sql;
EXECUTE drop_socket_datas_signal_strength_stmt;
DEALLOCATE PREPARE drop_socket_datas_signal_strength_stmt;

SET @has_socket_datas_uptime_sec := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'socket_datas' AND column_name = 'uptime_sec'
);
SET @drop_socket_datas_uptime_sec_sql := IF(
  @has_socket_datas_uptime_sec = 1,
  'ALTER TABLE socket_datas DROP COLUMN uptime_sec',
  'SELECT 1'
);
PREPARE drop_socket_datas_uptime_sec_stmt FROM @drop_socket_datas_uptime_sec_sql;
EXECUTE drop_socket_datas_uptime_sec_stmt;
DEALLOCATE PREPARE drop_socket_datas_uptime_sec_stmt;

-- Drop non-essential telemetry columns; keep core signals for charting.
SET @has_device_datas_sample_rate_hz := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'sample_rate_hz'
);
SET @drop_device_datas_sample_rate_hz_sql := IF(
  @has_device_datas_sample_rate_hz = 1,
  'ALTER TABLE device_datas DROP COLUMN sample_rate_hz',
  'SELECT 1'
);
PREPARE drop_device_datas_sample_rate_hz_stmt FROM @drop_device_datas_sample_rate_hz_sql;
EXECUTE drop_device_datas_sample_rate_hz_stmt;
DEALLOCATE PREPARE drop_device_datas_sample_rate_hz_stmt;

SET @has_device_datas_lsb_per_g := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'lsb_per_g'
);
SET @drop_device_datas_lsb_per_g_sql := IF(
  @has_device_datas_lsb_per_g = 1,
  'ALTER TABLE device_datas DROP COLUMN lsb_per_g',
  'SELECT 1'
);
PREPARE drop_device_datas_lsb_per_g_stmt FROM @drop_device_datas_lsb_per_g_sql;
EXECUTE drop_device_datas_lsb_per_g_stmt;
DEALLOCATE PREPARE drop_device_datas_lsb_per_g_stmt;

SET @has_device_datas_available := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'available'
);
SET @drop_device_datas_available_sql := IF(
  @has_device_datas_available = 1,
  'ALTER TABLE device_datas DROP COLUMN available',
  'SELECT 1'
);
PREPARE drop_device_datas_available_stmt FROM @drop_device_datas_available_sql;
EXECUTE drop_device_datas_available_stmt;
DEALLOCATE PREPARE drop_device_datas_available_stmt;

SET @has_device_datas_uuid := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'uuid'
);
SET @drop_device_datas_uuid_sql := IF(
  @has_device_datas_uuid = 1,
  'ALTER TABLE device_datas DROP COLUMN uuid',
  'SELECT 1'
);
PREPARE drop_device_datas_uuid_stmt FROM @drop_device_datas_uuid_sql;
EXECUTE drop_device_datas_uuid_stmt;
DEALLOCATE PREPARE drop_device_datas_uuid_stmt;

SET @has_device_datas_telemetry_uuid := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'telemetry_uuid'
);
SET @add_device_datas_telemetry_uuid_sql := IF(
  @has_device_datas_telemetry_uuid = 0,
  'ALTER TABLE device_datas ADD COLUMN telemetry_uuid VARCHAR(255) NULL AFTER sample_count',
  'SELECT 1'
);
PREPARE add_device_datas_telemetry_uuid_stmt FROM @add_device_datas_telemetry_uuid_sql;
EXECUTE add_device_datas_telemetry_uuid_stmt;
DEALLOCATE PREPARE add_device_datas_telemetry_uuid_stmt;

SET @add_device_datas_adxl_columns_sql := (
  SELECT COALESCE(
    CONCAT('ALTER TABLE device_datas ', GROUP_CONCAT(CONCAT('ADD COLUMN ', column_definition) ORDER BY column_name SEPARATOR ', ')),
    'SELECT 1'
  )
  FROM (
    SELECT 'message_id' AS column_name, 'message_id VARCHAR(255) NULL' AS column_definition
    UNION ALL SELECT 'temperature_available', 'temperature_available TINYINT(1) NULL'
    UNION ALL SELECT 'vibration_available', 'vibration_available TINYINT(1) NULL'
    UNION ALL SELECT 'adxl_status', 'adxl_status VARCHAR(16) NULL'
    UNION ALL SELECT 'adxl_fault_reason', 'adxl_fault_reason VARCHAR(32) NULL'
  ) AS required_columns
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'device_datas'
      AND column_name = required_columns.column_name
  )
);

SET @hour_metric_counts_preexisting := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'device_telemetry_hour_metric_summaries'
    AND column_name = 'temperature_sample_count'
);
SET @add_hour_metric_count_columns_sql := (
  SELECT COALESCE(
    CONCAT('ALTER TABLE device_telemetry_hour_metric_summaries ', GROUP_CONCAT(CONCAT('ADD COLUMN ', column_definition) ORDER BY column_name SEPARATOR ', ')),
    'SELECT 1'
  )
  FROM (
    SELECT 'temperature_sample_count' AS column_name, 'temperature_sample_count INT UNSIGNED NOT NULL DEFAULT 0' AS column_definition
    UNION ALL SELECT 'vibration_sample_count', 'vibration_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'ax_sample_count', 'ax_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'ay_sample_count', 'ay_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'az_sample_count', 'az_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'vrms_x_sample_count', 'vrms_x_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'vrms_y_sample_count', 'vrms_y_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'vrms_z_sample_count', 'vrms_z_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'drms_x_sample_count', 'drms_x_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'drms_y_sample_count', 'drms_y_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'drms_z_sample_count', 'drms_z_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'drms_band_min_sample_count', 'drms_band_min_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
    UNION ALL SELECT 'drms_band_max_sample_count', 'drms_band_max_sample_count INT UNSIGNED NOT NULL DEFAULT 0'
  ) AS required_columns
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'device_telemetry_hour_metric_summaries'
      AND column_name = required_columns.column_name
  )
);
PREPARE add_hour_metric_count_columns_stmt FROM @add_hour_metric_count_columns_sql;
EXECUTE add_hour_metric_count_columns_stmt;
DEALLOCATE PREPARE add_hour_metric_count_columns_stmt;

SET @backfill_hour_metric_count_columns_sql := IF(
  @hour_metric_counts_preexisting = 0,
  'UPDATE device_telemetry_hour_metric_summaries SET temperature_sample_count = IF(temperature IS NULL, 0, sample_count), vibration_sample_count = IF(vibration IS NULL, 0, sample_count), ax_sample_count = IF(ax IS NULL, 0, sample_count), ay_sample_count = IF(ay IS NULL, 0, sample_count), az_sample_count = IF(az IS NULL, 0, sample_count), vrms_x_sample_count = IF(vrms_x_mms IS NULL, 0, sample_count), vrms_y_sample_count = IF(vrms_y_mms IS NULL, 0, sample_count), vrms_z_sample_count = IF(vrms_z_mms IS NULL, 0, sample_count), drms_x_sample_count = IF(drms_x_um IS NULL, 0, sample_count), drms_y_sample_count = IF(drms_y_um IS NULL, 0, sample_count), drms_z_sample_count = IF(drms_z_um IS NULL, 0, sample_count), drms_band_min_sample_count = IF(drms_band_min_hz IS NULL, 0, sample_count), drms_band_max_sample_count = IF(drms_band_max_hz IS NULL, 0, sample_count)',
  'SELECT 1'
);
PREPARE backfill_hour_metric_count_columns_stmt FROM @backfill_hour_metric_count_columns_sql;
EXECUTE backfill_hour_metric_count_columns_stmt;
DEALLOCATE PREPARE backfill_hour_metric_count_columns_stmt;
PREPARE add_device_datas_adxl_columns_stmt FROM @add_device_datas_adxl_columns_sql;
EXECUTE add_device_datas_adxl_columns_stmt;
DEALLOCATE PREPARE add_device_datas_adxl_columns_stmt;

UPDATE device_datas
SET message_id = NULL
WHERE message_id IS NOT NULL AND TRIM(message_id) = '';

DELETE d1
FROM device_datas d1
JOIN device_datas d2
  ON d1.device_id = d2.device_id
 AND d1.message_id = d2.message_id
 AND d1.message_id IS NOT NULL
 AND d1.id < d2.id;

SET @has_uq_device_datas_device_message_id := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'device_datas'
    AND index_name = 'uq_device_datas_device_message_id'
);
SET @add_uq_device_datas_device_message_id_sql := IF(
  @has_uq_device_datas_device_message_id = 0,
  'ALTER TABLE device_datas ADD UNIQUE KEY uq_device_datas_device_message_id (device_id, message_id)',
  'SELECT 1'
);
PREPARE add_uq_device_datas_device_message_id_stmt FROM @add_uq_device_datas_device_message_id_sql;
EXECUTE add_uq_device_datas_device_message_id_stmt;
DEALLOCATE PREPARE add_uq_device_datas_device_message_id_stmt;

SET @has_device_datas_vrms_x_mms := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'vrms_x_mms'
);
SET @add_device_datas_vrms_x_mms_sql := IF(
  @has_device_datas_vrms_x_mms = 0,
  'ALTER TABLE device_datas ADD COLUMN vrms_x_mms DOUBLE NULL AFTER az',
  'SELECT 1'
);
PREPARE add_device_datas_vrms_x_mms_stmt FROM @add_device_datas_vrms_x_mms_sql;
EXECUTE add_device_datas_vrms_x_mms_stmt;
DEALLOCATE PREPARE add_device_datas_vrms_x_mms_stmt;

SET @has_device_datas_vrms_y_mms := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'vrms_y_mms'
);
SET @add_device_datas_vrms_y_mms_sql := IF(
  @has_device_datas_vrms_y_mms = 0,
  'ALTER TABLE device_datas ADD COLUMN vrms_y_mms DOUBLE NULL AFTER vrms_x_mms',
  'SELECT 1'
);
PREPARE add_device_datas_vrms_y_mms_stmt FROM @add_device_datas_vrms_y_mms_sql;
EXECUTE add_device_datas_vrms_y_mms_stmt;
DEALLOCATE PREPARE add_device_datas_vrms_y_mms_stmt;

SET @has_device_datas_vrms_z_mms := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'vrms_z_mms'
);
SET @add_device_datas_vrms_z_mms_sql := IF(
  @has_device_datas_vrms_z_mms = 0,
  'ALTER TABLE device_datas ADD COLUMN vrms_z_mms DOUBLE NULL AFTER vrms_y_mms',
  'SELECT 1'
);
PREPARE add_device_datas_vrms_z_mms_stmt FROM @add_device_datas_vrms_z_mms_sql;
EXECUTE add_device_datas_vrms_z_mms_stmt;
DEALLOCATE PREPARE add_device_datas_vrms_z_mms_stmt;

SET @has_device_datas_vrms_unit := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'vrms_unit'
);
SET @add_device_datas_vrms_unit_sql := IF(
  @has_device_datas_vrms_unit = 0,
  'ALTER TABLE device_datas ADD COLUMN vrms_unit VARCHAR(32) NULL AFTER vrms_z_mms',
  'SELECT 1'
);
PREPARE add_device_datas_vrms_unit_stmt FROM @add_device_datas_vrms_unit_sql;
EXECUTE add_device_datas_vrms_unit_stmt;
DEALLOCATE PREPARE add_device_datas_vrms_unit_stmt;

SET @has_device_datas_drms_x_um := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_x_um'
);
SET @add_device_datas_drms_x_um_sql := IF(
  @has_device_datas_drms_x_um = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_x_um DOUBLE NULL AFTER vrms_unit',
  'SELECT 1'
);
PREPARE add_device_datas_drms_x_um_stmt FROM @add_device_datas_drms_x_um_sql;
EXECUTE add_device_datas_drms_x_um_stmt;
DEALLOCATE PREPARE add_device_datas_drms_x_um_stmt;

SET @has_device_datas_drms_y_um := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_y_um'
);
SET @add_device_datas_drms_y_um_sql := IF(
  @has_device_datas_drms_y_um = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_y_um DOUBLE NULL AFTER drms_x_um',
  'SELECT 1'
);
PREPARE add_device_datas_drms_y_um_stmt FROM @add_device_datas_drms_y_um_sql;
EXECUTE add_device_datas_drms_y_um_stmt;
DEALLOCATE PREPARE add_device_datas_drms_y_um_stmt;

SET @has_device_datas_drms_z_um := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_z_um'
);
SET @add_device_datas_drms_z_um_sql := IF(
  @has_device_datas_drms_z_um = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_z_um DOUBLE NULL AFTER drms_y_um',
  'SELECT 1'
);
PREPARE add_device_datas_drms_z_um_stmt FROM @add_device_datas_drms_z_um_sql;
EXECUTE add_device_datas_drms_z_um_stmt;
DEALLOCATE PREPARE add_device_datas_drms_z_um_stmt;

SET @has_device_datas_drms_band_min_hz := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_band_min_hz'
);
SET @add_device_datas_drms_band_min_hz_sql := IF(
  @has_device_datas_drms_band_min_hz = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_band_min_hz DOUBLE NULL AFTER drms_z_um',
  'SELECT 1'
);
PREPARE add_device_datas_drms_band_min_hz_stmt FROM @add_device_datas_drms_band_min_hz_sql;
EXECUTE add_device_datas_drms_band_min_hz_stmt;
DEALLOCATE PREPARE add_device_datas_drms_band_min_hz_stmt;

SET @has_device_datas_drms_band_max_hz := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_band_max_hz'
);
SET @add_device_datas_drms_band_max_hz_sql := IF(
  @has_device_datas_drms_band_max_hz = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_band_max_hz DOUBLE NULL AFTER drms_band_min_hz',
  'SELECT 1'
);
PREPARE add_device_datas_drms_band_max_hz_stmt FROM @add_device_datas_drms_band_max_hz_sql;
EXECUTE add_device_datas_drms_band_max_hz_stmt;
DEALLOCATE PREPARE add_device_datas_drms_band_max_hz_stmt;

SET @has_device_datas_drms_unit := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_datas' AND column_name = 'drms_unit'
);
SET @add_device_datas_drms_unit_sql := IF(
  @has_device_datas_drms_unit = 0,
  'ALTER TABLE device_datas ADD COLUMN drms_unit VARCHAR(32) NULL AFTER drms_band_max_hz',
  'SELECT 1'
);
PREPARE add_device_datas_drms_unit_stmt FROM @add_device_datas_drms_unit_sql;
EXECUTE add_device_datas_drms_unit_stmt;
DEALLOCATE PREPARE add_device_datas_drms_unit_stmt;

-- Normalize and dedupe telemetry_uuid before adding uniqueness.
UPDATE device_datas
SET telemetry_uuid = NULL
WHERE telemetry_uuid IS NOT NULL AND TRIM(telemetry_uuid) = '';

DELETE d1
FROM device_datas d1
JOIN device_datas d2
  ON d1.device_id = d2.device_id
 AND d1.telemetry_uuid = d2.telemetry_uuid
 AND d1.telemetry_uuid IS NOT NULL
 AND d1.id < d2.id;

SET @has_uq_device_datas_device_telemetry_uuid := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'device_datas'
    AND index_name = 'uq_device_datas_device_telemetry_uuid'
);
SET @add_uq_device_datas_device_telemetry_uuid_sql := IF(
  @has_uq_device_datas_device_telemetry_uuid = 0,
  'ALTER TABLE device_datas ADD UNIQUE KEY uq_device_datas_device_telemetry_uuid (device_id, telemetry_uuid)',
  'SELECT 1'
);
PREPARE add_uq_device_datas_device_telemetry_uuid_stmt FROM @add_uq_device_datas_device_telemetry_uuid_sql;
EXECUTE add_uq_device_datas_device_telemetry_uuid_stmt;
DEALLOCATE PREPARE add_uq_device_datas_device_telemetry_uuid_stmt;

SET @has_device_spectrum_frames_device_data_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'device_spectrum_frames' AND column_name = 'device_data_id'
);
SET @add_device_spectrum_frames_device_data_id_sql := IF(
  @has_device_spectrum_frames_device_data_id = 0,
  'ALTER TABLE device_spectrum_frames ADD COLUMN device_data_id BIGINT NULL AFTER device_id',
  'SELECT 1'
);
PREPARE add_device_spectrum_frames_device_data_id_stmt FROM @add_device_spectrum_frames_device_data_id_sql;
EXECUTE add_device_spectrum_frames_device_data_id_stmt;
DEALLOCATE PREPARE add_device_spectrum_frames_device_data_id_stmt;

SET @has_idx_device_spectrum_frames_device_data_id := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'device_spectrum_frames'
    AND index_name = 'idx_device_spectrum_frames_device_data_id'
);
SET @add_idx_device_spectrum_frames_device_data_id_sql := IF(
  @has_idx_device_spectrum_frames_device_data_id = 0,
  'ALTER TABLE device_spectrum_frames ADD KEY idx_device_spectrum_frames_device_data_id (device_data_id)',
  'SELECT 1'
);
PREPARE add_idx_device_spectrum_frames_device_data_id_stmt FROM @add_idx_device_spectrum_frames_device_data_id_sql;
EXECUTE add_idx_device_spectrum_frames_device_data_id_stmt;
DEALLOCATE PREPARE add_idx_device_spectrum_frames_device_data_id_stmt;

-- System-scoped audit events may not belong to a concrete device.
SET @audit_logs_device_nullable := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'audit_logs'
    AND column_name = 'device_id'
    AND is_nullable = 'YES'
);
SET @set_audit_logs_device_nullable_sql := IF(
  @audit_logs_device_nullable = 0,
  'ALTER TABLE audit_logs MODIFY COLUMN device_id VARCHAR(191) NULL',
  'SELECT 1'
);
PREPARE set_audit_logs_device_nullable_stmt FROM @set_audit_logs_device_nullable_sql;
EXECUTE set_audit_logs_device_nullable_stmt;
DEALLOCATE PREPARE set_audit_logs_device_nullable_stmt;

UPDATE audit_logs
SET device_id = NULL
WHERE device_id IS NOT NULL
  AND (
    TRIM(device_id) = ''
    OR LOWER(TRIM(device_id)) = 'n/a'
  );

-- Cleanup orphan rows so FK backfill on legacy schemas can succeed.
DELETE sd
FROM socket_datas sd
LEFT JOIN devices d ON d.device_id = sd.device_id
WHERE d.device_id IS NULL;

DELETE a
FROM alerts a
LEFT JOIN alert_rules r ON r.rule_id = a.rule_id
LEFT JOIN devices d ON d.device_id = a.device_id
WHERE r.rule_id IS NULL OR d.device_id IS NULL;

DELETE al
FROM audit_logs al
LEFT JOIN devices d ON d.device_id = al.device_id
WHERE al.device_id IS NOT NULL AND d.device_id IS NULL;

DELETE tm
FROM device_datas tm
LEFT JOIN devices d ON d.device_id = tm.device_id
WHERE d.device_id IS NULL;

DELETE sf
FROM device_spectrum_frames sf
LEFT JOIN devices d ON d.device_id = sf.device_id
WHERE d.device_id IS NULL;

-- Backfill spectrum -> device_datas linkage by telemetry_uuid.
UPDATE device_spectrum_frames sf
JOIN device_datas dd
  ON dd.device_id = sf.device_id
 AND dd.telemetry_uuid = sf.telemetry_uuid
SET sf.device_data_id = dd.id
WHERE sf.device_data_id IS NULL
  AND sf.telemetry_uuid IS NOT NULL;

UPDATE device_spectrum_frames sf
LEFT JOIN device_datas dd ON dd.id = sf.device_data_id
SET sf.device_data_id = NULL
WHERE sf.device_data_id IS NOT NULL
  AND dd.id IS NULL;

-- Reset legacy free-text zone assignments once before enforcing FK to zones.code.
SET @has_fk_devices_zone := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'devices'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_devices_zone'
);
SET @reset_devices_zone_once_sql := IF(
  @has_fk_devices_zone = 0,
  'UPDATE devices SET zone = NULL WHERE zone IS NOT NULL',
  'SELECT 1'
);
PREPARE reset_devices_zone_once_stmt FROM @reset_devices_zone_once_sql;
EXECUTE reset_devices_zone_once_stmt;
DEALLOCATE PREPARE reset_devices_zone_once_stmt;

-- Keep only valid zone codes before adding FK.
UPDATE devices d
LEFT JOIN zones z ON z.code = d.zone
SET d.zone = NULL
WHERE d.zone IS NOT NULL AND z.code IS NULL;

-- Backfill FKs for schemas created before constraints existed.
SET @has_fk_socket_datas_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'socket_datas'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_socket_datas_device'
);
SET @add_fk_socket_datas_device_sql := IF(
  @has_fk_socket_datas_device = 0,
  'ALTER TABLE socket_datas ADD CONSTRAINT fk_socket_datas_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE add_fk_socket_datas_device_stmt FROM @add_fk_socket_datas_device_sql;
EXECUTE add_fk_socket_datas_device_stmt;
DEALLOCATE PREPARE add_fk_socket_datas_device_stmt;

SET @has_fk_alerts_rule := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'alerts'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_alerts_rule'
);
SET @add_fk_alerts_rule_sql := IF(
  @has_fk_alerts_rule = 0,
  'ALTER TABLE alerts ADD CONSTRAINT fk_alerts_rule FOREIGN KEY (rule_id) REFERENCES alert_rules(rule_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_fk_alerts_rule_stmt FROM @add_fk_alerts_rule_sql;
EXECUTE add_fk_alerts_rule_stmt;
DEALLOCATE PREPARE add_fk_alerts_rule_stmt;

SET @has_fk_alerts_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'alerts'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_alerts_device'
);
SET @add_fk_alerts_device_sql := IF(
  @has_fk_alerts_device = 0,
  'ALTER TABLE alerts ADD CONSTRAINT fk_alerts_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_fk_alerts_device_stmt FROM @add_fk_alerts_device_sql;
EXECUTE add_fk_alerts_device_stmt;
DEALLOCATE PREPARE add_fk_alerts_device_stmt;

SET @has_fk_audit_logs_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'audit_logs'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_audit_logs_device'
);
SET @add_fk_audit_logs_device_sql := IF(
  @has_fk_audit_logs_device = 0,
  'ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_logs_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_fk_audit_logs_device_stmt FROM @add_fk_audit_logs_device_sql;
EXECUTE add_fk_audit_logs_device_stmt;
DEALLOCATE PREPARE add_fk_audit_logs_device_stmt;

SET @has_fk_device_commands_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'device_commands'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_device_commands_device'
);
SET @add_fk_device_commands_device_sql := IF(
  @has_fk_device_commands_device = 0,
  'ALTER TABLE device_commands ADD CONSTRAINT fk_device_commands_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_fk_device_commands_device_stmt FROM @add_fk_device_commands_device_sql;
EXECUTE add_fk_device_commands_device_stmt;
DEALLOCATE PREPARE add_fk_device_commands_device_stmt;

SET @has_fk_device_datas_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'device_datas'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name IN (
      'fk_device_datas_device',
      'fk_sensor_datas_device',
      'fk_sensor_readings_device',
      'fk_telemetry_messages_device'
    )
);
SET @add_fk_device_datas_device_sql := IF(
  @has_fk_device_datas_device = 0,
  'ALTER TABLE device_datas ADD CONSTRAINT fk_device_datas_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE add_fk_device_datas_device_stmt FROM @add_fk_device_datas_device_sql;
EXECUTE add_fk_device_datas_device_stmt;
DEALLOCATE PREPARE add_fk_device_datas_device_stmt;

SET @has_fk_device_spectrum_frames_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'device_spectrum_frames'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_device_spectrum_frames_device'
);
SET @add_fk_device_spectrum_frames_device_sql := IF(
  @has_fk_device_spectrum_frames_device = 0,
  'ALTER TABLE device_spectrum_frames ADD CONSTRAINT fk_device_spectrum_frames_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE add_fk_device_spectrum_frames_device_stmt FROM @add_fk_device_spectrum_frames_device_sql;
EXECUTE add_fk_device_spectrum_frames_device_stmt;
DEALLOCATE PREPARE add_fk_device_spectrum_frames_device_stmt;

SET @has_fk_device_spectrum_frames_device_data := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'device_spectrum_frames'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_device_spectrum_frames_device_data'
);
SET @add_fk_device_spectrum_frames_device_data_sql := IF(
  @has_fk_device_spectrum_frames_device_data = 0,
  'ALTER TABLE device_spectrum_frames ADD CONSTRAINT fk_device_spectrum_frames_device_data FOREIGN KEY (device_data_id) REFERENCES device_datas(id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_device_spectrum_frames_device_data_stmt FROM @add_fk_device_spectrum_frames_device_data_sql;
EXECUTE add_fk_device_spectrum_frames_device_data_stmt;
DEALLOCATE PREPARE add_fk_device_spectrum_frames_device_data_stmt;

SET @has_fk_devices_zone := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'devices'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_devices_zone'
);
SET @add_fk_devices_zone_sql := IF(
  @has_fk_devices_zone = 0,
  'ALTER TABLE devices ADD CONSTRAINT fk_devices_zone FOREIGN KEY (zone) REFERENCES zones(code) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_devices_zone_stmt FROM @add_fk_devices_zone_sql;
EXECUTE add_fk_devices_zone_stmt;
DEALLOCATE PREPARE add_fk_devices_zone_stmt;

-- Optional secondary indexes can be added manually after bootstrap.
`;
