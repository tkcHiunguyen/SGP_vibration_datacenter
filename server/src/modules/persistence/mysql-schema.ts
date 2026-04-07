export const MYSQL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS device_metadata (
  device_id VARCHAR(191) PRIMARY KEY,
  uuid VARCHAR(255) NULL,
  name VARCHAR(255) NULL,
  site VARCHAR(128) NULL,
  zone VARCHAR(128) NULL,
  firmware_version VARCHAR(128) NULL,
  sensor_version VARCHAR(128) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS device_sessions (
  device_id VARCHAR(191) PRIMARY KEY,
  socket_id VARCHAR(191) NOT NULL,
  client_ip VARCHAR(191) NULL,
  connected_at DATETIME(3) NOT NULL,
  last_heartbeat_at DATETIME(3) NOT NULL,
  socket_connected TINYINT(1) NULL,
  sta_connected TINYINT(1) NULL,
  signal_strength INT NULL,
  uptime_sec INT NULL
);

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
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id VARCHAR(191) PRIMARY KEY,
  action VARCHAR(191) NOT NULL,
  device_id VARCHAR(191) NOT NULL,
  command_id VARCHAR(191) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  result VARCHAR(191) NOT NULL,
  metadata JSON NULL
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
  closed_by VARCHAR(191) NULL
);

CREATE TABLE IF NOT EXISTS incident_timeline (
  entry_id VARCHAR(191) PRIMARY KEY,
  incident_id VARCHAR(191) NOT NULL,
  type VARCHAR(64) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  message TEXT NULL,
  metadata JSON NULL
);

CREATE TABLE IF NOT EXISTS telemetry_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(191) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  temperature DOUBLE NULL,
  vibration DOUBLE NULL,
  ax DOUBLE NULL,
  ay DOUBLE NULL,
  az DOUBLE NULL,
  sample_count INT NULL,
  sample_rate_hz DOUBLE NULL,
  lsb_per_g DOUBLE NULL,
  available TINYINT(1) NULL,
  uuid VARCHAR(255) NULL,
  telemetry_uuid VARCHAR(255) NULL,
  KEY idx_telemetry_device_time (device_id, received_at),
  KEY idx_telemetry_received_at (received_at)
);

-- Optional secondary indexes can be added manually after bootstrap.
`;
