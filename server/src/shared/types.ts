export type DeviceClientType = 'device' | 'dashboard';

export type TelemetryPayload = {
  vibration?: number;
  temperature?: number;
  [key: string]: unknown;
};

export type TelemetryMessage = {
  deviceId: string;
  receivedAt: string;
  payload: TelemetryPayload;
};

export type SpectrumAxis = 'x' | 'y' | 'z';

export type TelemetrySpectrumMessage = {
  deviceId: string;
  receivedAt: string;
  axis: SpectrumAxis;
  telemetryUuid?: string;
  uuid?: string;
  sourceSampleCount?: number;
  sampleRateHz?: number;
  binCount: number;
  binHz?: number;
  valueScale?: number;
  magnitudeUnit?: string;
  amplitudes: number[];
  peakBinIndex?: number;
  peakFrequencyHz?: number;
  peakAmplitude?: number;
};

export type AlertMetric = 'temperature' | 'vibration';

export type AlertSeverity = 'warning' | 'critical';

export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export type AlertNoiseState = 'normal' | 'coalesced' | 'suppressed' | 'flapping';

export type AlertTimeWindow = {
  startHour: number;
  endHour: number;
  timezone?: string;
};

export type AlertRule = {
  ruleId: string;
  name: string;
  metric: AlertMetric;
  threshold: number;
  severity: AlertSeverity;
  debounceCount: number;
  cooldownMs: number;
  suppressionWindowMs: number;
  flappingWindowMs: number;
  flappingThreshold: number;
  enabled: boolean;
  timeWindow?: AlertTimeWindow;
  createdAt: string;
  updatedAt: string;
};

export type AlertRecord = {
  alertId: string;
  ruleId: string;
  ruleName: string;
  deviceId: string;
  metric: AlertMetric;
  severity: AlertSeverity;
  threshold: number;
  triggerValue: number;
  lastValue: number;
  occurrenceCount: number;
  suppressedCount: number;
  noiseState: AlertNoiseState;
  lastSuppressedAt?: string;
  status: AlertStatus;
  triggeredAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedNote?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
  updatedAt: string;
};

export type IncidentStatus = 'open' | 'assigned' | 'monitoring' | 'resolved' | 'closed';

export type IncidentEventType =
  | 'created'
  | 'assigned'
  | 'monitoring'
  | 'resolved'
  | 'closed'
  | 'note'
  | 'linked_alert'
  | 'acknowledged';

export type IncidentTimelineEntry = {
  entryId: string;
  incidentId: string;
  type: IncidentEventType;
  actor: string;
  createdAt: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

export type IncidentRecord = {
  incidentId: string;
  title: string;
  summary?: string;
  severity: AlertSeverity;
  status: IncidentStatus;
  owner?: string;
  site?: string;
  deviceId?: string;
  alertIds: string[];
  primaryAlertId?: string;
  createdAt: string;
  updatedAt: string;
  openedAt: string;
  assignedAt?: string;
  assignedBy?: string;
  monitoringAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  closedAt?: string;
  closedBy?: string;
};

export type DeviceSession = {
  deviceId: string;
  socketId: string;
  clientIp?: string;
  connectedAt: string;
  lastHeartbeatAt: string;
  heartbeat?: DeviceHeartbeat;
};

export type DeviceHeartbeat = {
  socketConnected?: boolean;
  staConnected?: boolean;
  signal?: number;
  uptimeSec?: number;
};

export type DeviceMetadata = {
  deviceId: string;
  uuid?: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  sensorVersion?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type CommandType = 'capture' | 'calibrate' | 'restart' | 'set_config' | 'ota' | 'ota_from_url';

export type DeviceCommand = {
  commandId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  sentAt: string;
};

export type DeviceCommandAck = {
  commandId: string;
  deviceId: string;
  receivedAt: string;
  status?: string;
  detail?: string;
  uuid?: string;
  firmwareVersion?: string;
  raw?: Record<string, unknown>;
};

export type CommandStatus = 'sent' | 'acked' | 'timeout';

export type CommandRecord = DeviceCommand & {
  deviceId: string;
  status: CommandStatus;
  timeoutAt: string;
  statusUpdatedAt: string;
  ackedAt?: string;
  timeoutedAt?: string;
  ackStatus?: string;
  ackDetail?: string;
  ackDeviceUuid?: string;
  ackFirmwareVersion?: string;
  ackHistory?: DeviceCommandAck[];
};
