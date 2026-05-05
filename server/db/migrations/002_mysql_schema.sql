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

CREATE TABLE IF NOT EXISTS incidents (
  incident_id VARCHAR(191) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  severity VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  owner VARCHAR(191) NULL,
  site VARCHAR(128) NULL,
  device_id VARCHAR(191) NULL,
  alert_ids JSON NOT NULL,
  primary_alert_id VARCHAR(191) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  opened_at DATETIME(3) NOT NULL,
  assigned_at DATETIME(3) NULL,
  assigned_by VARCHAR(191) NULL,
  monitoring_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  resolved_by VARCHAR(191) NULL,
  closed_at DATETIME(3) NULL,
  closed_by VARCHAR(191) NULL,
  KEY idx_incidents_device_id (device_id),
  KEY idx_incidents_primary_alert_id (primary_alert_id),
  CONSTRAINT fk_incidents_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,
  CONSTRAINT fk_incidents_primary_alert
    FOREIGN KEY (primary_alert_id) REFERENCES alerts(alert_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS incident_timeline (
  entry_id VARCHAR(191) PRIMARY KEY,
  incident_id VARCHAR(191) NOT NULL,
  type VARCHAR(64) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  message TEXT NULL,
  metadata JSON NULL,
  KEY idx_incident_timeline_incident_id (incident_id),
  CONSTRAINT fk_incident_timeline_incident
    FOREIGN KEY (incident_id) REFERENCES incidents(incident_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
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
  sample_count INT NULL,
  telemetry_uuid VARCHAR(255) NULL,
  KEY idx_device_datas_device_time (device_id, received_at),
  KEY idx_device_datas_received_at (received_at),
  UNIQUE KEY uq_device_datas_device_telemetry_uuid (device_id, telemetry_uuid),
  CONSTRAINT fk_device_datas_device
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
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

UPDATE incidents i
LEFT JOIN devices d ON d.device_id = i.device_id
SET i.device_id = NULL
WHERE i.device_id IS NOT NULL AND d.device_id IS NULL;

UPDATE incidents i
LEFT JOIN alerts a ON a.alert_id = i.primary_alert_id
SET i.primary_alert_id = NULL
WHERE i.primary_alert_id IS NOT NULL AND a.alert_id IS NULL;

DELETE it
FROM incident_timeline it
LEFT JOIN incidents i ON i.incident_id = it.incident_id
WHERE i.incident_id IS NULL;

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

SET @has_fk_incidents_device := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'incidents'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_incidents_device'
);
SET @add_fk_incidents_device_sql := IF(
  @has_fk_incidents_device = 0,
  'ALTER TABLE incidents ADD CONSTRAINT fk_incidents_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_incidents_device_stmt FROM @add_fk_incidents_device_sql;
EXECUTE add_fk_incidents_device_stmt;
DEALLOCATE PREPARE add_fk_incidents_device_stmt;

SET @has_fk_incidents_primary_alert := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'incidents'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_incidents_primary_alert'
);
SET @add_fk_incidents_primary_alert_sql := IF(
  @has_fk_incidents_primary_alert = 0,
  'ALTER TABLE incidents ADD CONSTRAINT fk_incidents_primary_alert FOREIGN KEY (primary_alert_id) REFERENCES alerts(alert_id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE add_fk_incidents_primary_alert_stmt FROM @add_fk_incidents_primary_alert_sql;
EXECUTE add_fk_incidents_primary_alert_stmt;
DEALLOCATE PREPARE add_fk_incidents_primary_alert_stmt;

SET @has_fk_incident_timeline_incident := (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'incident_timeline'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_incident_timeline_incident'
);
SET @add_fk_incident_timeline_incident_sql := IF(
  @has_fk_incident_timeline_incident = 0,
  'ALTER TABLE incident_timeline ADD CONSTRAINT fk_incident_timeline_incident FOREIGN KEY (incident_id) REFERENCES incidents(incident_id) ON UPDATE CASCADE ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE add_fk_incident_timeline_incident_stmt FROM @add_fk_incident_timeline_incident_sql;
EXECUTE add_fk_incident_timeline_incident_stmt;
DEALLOCATE PREPARE add_fk_incident_timeline_incident_stmt;

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
