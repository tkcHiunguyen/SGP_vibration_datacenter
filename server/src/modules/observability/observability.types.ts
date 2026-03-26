export type MetricValue = number;

export type MetricLabelValue = string | number | boolean | null | undefined;

export type MetricLabelSet = Record<string, MetricLabelValue>;

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export type MetricSnapshot = {
  name: string;
  kind: MetricKind;
  help?: string;
  unit?: string;
};

export type CounterSnapshot = MetricSnapshot & {
  kind: 'counter';
  value: number;
};

export type GaugeSnapshot = MetricSnapshot & {
  kind: 'gauge';
  value: number;
};

export type HistogramBucketSnapshot = {
  le: number;
  count: number;
};

export type HistogramSnapshot = MetricSnapshot & {
  kind: 'histogram';
  count: number;
  sum: number;
  buckets: HistogramBucketSnapshot[];
};

export type MetricsSnapshot = {
  counters: CounterSnapshot[];
  gauges: GaugeSnapshot[];
  histograms: HistogramSnapshot[];
};

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export type HealthProbeKind = 'liveness' | 'readiness';

export type HealthCheckResult = {
  name: string;
  status: HealthStatus;
  checkedAt: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type HealthSnapshot = {
  service: string;
  kind: HealthProbeKind;
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheckResult[];
};

export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLogContext = Record<string, unknown>;

export type StructuredLogEvent = StructuredLogContext & {
  event: string;
  message?: string;
  level?: StructuredLogLevel;
  timestamp: string;
};

