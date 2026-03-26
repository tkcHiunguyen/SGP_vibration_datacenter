import type {
  CounterSnapshot,
  GaugeSnapshot,
  HistogramBucketSnapshot,
  HistogramSnapshot,
  MetricLabelSet,
  MetricValue,
  MetricsSnapshot,
} from './observability.types.js';

type MetricDefinition = {
  name: string;
  help?: string;
  unit?: string;
  labelsKey: string;
};

type CounterState = {
  definition: MetricDefinition;
  value: number;
};

type GaugeState = {
  definition: MetricDefinition;
  value: number;
};

type HistogramState = {
  definition: MetricDefinition;
  buckets: number[];
  count: number;
  sum: number;
  bucketCounts: number[];
};

function normalizeLabels(labels: MetricLabelSet = {}): string {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  return JSON.stringify(entries);
}

function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function sanitizeMetricValue(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function defaultHistogramBuckets(): number[] {
  return [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
}

export type ObservabilityMetricsOptions = {
  service?: string;
  histogramBuckets?: number[];
};

export class ObservabilityMetricsRegistry {
  private readonly counters = new Map<string, CounterState>();
  private readonly gauges = new Map<string, GaugeState>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly service: string;
  private readonly histogramBuckets: number[];

  constructor(options: ObservabilityMetricsOptions = {}) {
    this.service = options.service ?? 'service';
    this.histogramBuckets = [...(options.histogramBuckets ?? defaultHistogramBuckets())].sort(
      (left, right) => left - right,
    );
  }

  incCounter(name: string, value = 1, labels: MetricLabelSet = {}, help?: string): number {
    const key = this.metricKey(name, labels);
    const definition = this.definition(name, labels, help, 'counter');
    const current = this.counters.get(key) ?? { definition, value: 0 };
    current.definition = definition;
    current.value += sanitizeMetricValue(value);
    this.counters.set(key, current);
    return current.value;
  }

  setGauge(name: string, value: number, labels: MetricLabelSet = {}, help?: string): number {
    const key = this.metricKey(name, labels);
    const definition = this.definition(name, labels, help, 'gauge');
    const normalized = sanitizeMetricValue(value);
    this.gauges.set(key, { definition, value: normalized });
    return normalized;
  }

  observeHistogram(name: string, value: number, labels: MetricLabelSet = {}, help?: string): void {
    const key = this.metricKey(name, labels);
    const definition = this.definition(name, labels, help, 'histogram');
    const current =
      this.histograms.get(key) ??
      {
        definition,
        buckets: [...this.histogramBuckets],
        count: 0,
        sum: 0,
        bucketCounts: new Array(this.histogramBuckets.length).fill(0),
      };

    current.definition = definition;
    current.count += 1;
    current.sum += sanitizeMetricValue(value);

    for (let index = 0; index < current.buckets.length; index += 1) {
      if (value <= current.buckets[index]) {
        current.bucketCounts[index] += 1;
      }
    }

    this.histograms.set(key, current);
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: [...this.counters.values()].map((entry) => this.counterSnapshot(entry)),
      gauges: [...this.gauges.values()].map((entry) => this.gaugeSnapshot(entry)),
      histograms: [...this.histograms.values()].map((entry) => this.histogramSnapshot(entry)),
    };
  }

  renderPrometheus(): string {
    const snapshot = this.snapshot();
    const lines: string[] = [];

    for (const counter of snapshot.counters) {
      this.pushMetric(lines, counter, counter.value);
    }

    for (const gauge of snapshot.gauges) {
      this.pushMetric(lines, gauge, gauge.value);
    }

    for (const histogram of snapshot.histograms) {
      const baseName = this.prometheusName(histogram.name);
      if (histogram.help) {
        lines.push(`# HELP ${baseName} ${histogram.help}`);
      }
      lines.push(`# TYPE ${baseName} histogram`);
      for (const bucket of histogram.buckets) {
        lines.push(`${baseName}_bucket${this.labelsToString({ le: this.bucketLabel(bucket.le) })} ${bucket.count}`);
      }
      lines.push(`${baseName}_count ${histogram.count}`);
      lines.push(`${baseName}_sum ${histogram.sum}`);
    }

    return lines.join('\n');
  }

  private definition(
    name: string,
    labels: MetricLabelSet,
    help: string | undefined,
    kind: 'counter' | 'gauge' | 'histogram',
  ): MetricDefinition {
    return {
      name: sanitizeMetricName(name),
      help,
      labelsKey: this.metricKey(name, labels),
      unit: undefined,
    };
  }

  private metricKey(name: string, labels: MetricLabelSet): string {
    return `${sanitizeMetricName(name)}|${normalizeLabels(labels)}`;
  }

  private counterSnapshot(entry: CounterState): CounterSnapshot {
    return {
      kind: 'counter',
      name: entry.definition.name,
      help: entry.definition.help,
      unit: entry.definition.unit,
      value: entry.value,
    };
  }

  private gaugeSnapshot(entry: GaugeState): GaugeSnapshot {
    return {
      kind: 'gauge',
      name: entry.definition.name,
      help: entry.definition.help,
      unit: entry.definition.unit,
      value: entry.value,
    };
  }

  private histogramSnapshot(entry: HistogramState): HistogramSnapshot {
    const buckets: HistogramBucketSnapshot[] = entry.buckets.map((bucket, index) => ({
      le: bucket,
      count: entry.bucketCounts[index] ?? 0,
    }));

    buckets.push({
      le: Number.POSITIVE_INFINITY,
      count: entry.count,
    });

    return {
      kind: 'histogram',
      name: entry.definition.name,
      help: entry.definition.help,
      unit: entry.definition.unit,
      count: entry.count,
      sum: entry.sum,
      buckets,
    };
  }

  private pushMetric(lines: string[], metric: CounterSnapshot | GaugeSnapshot, value: MetricValue): void {
    const baseName = this.prometheusName(metric.name);
    if (metric.help) {
      lines.push(`# HELP ${baseName} ${metric.help}`);
    }
    lines.push(`# TYPE ${baseName} ${metric.kind}`);
    lines.push(`${baseName} ${value}`);
  }

  private labelsToString(labels: MetricLabelSet): string {
    const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null);
    if (!entries.length) {
      return '';
    }

    const rendered = entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',');
    return `{${rendered}}`;
  }

  private bucketLabel(value: number): string {
    if (value === Number.POSITIVE_INFINITY) {
      return '+Inf';
    }
    return String(value);
  }

  private prometheusName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_:]/g, '_');
  }
}

export function createObservabilityMetrics(
  options: ObservabilityMetricsOptions = {},
): ObservabilityMetricsRegistry {
  return new ObservabilityMetricsRegistry(options);
}

export function renderPrometheusMetrics(metrics: MetricsSnapshot): string {
  const lines: string[] = [];

  for (const counter of metrics.counters) {
    if (counter.help) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
    }
    lines.push(`# TYPE ${counter.name} counter`);
    lines.push(`${counter.name} ${counter.value}`);
  }

  for (const gauge of metrics.gauges) {
    if (gauge.help) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
    }
    lines.push(`# TYPE ${gauge.name} gauge`);
    lines.push(`${gauge.name} ${gauge.value}`);
  }

  for (const histogram of metrics.histograms) {
    if (histogram.help) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
    }
    lines.push(`# TYPE ${histogram.name} histogram`);
    for (const bucket of histogram.buckets) {
      const le = bucket.le === Number.POSITIVE_INFINITY ? '+Inf' : String(bucket.le);
      lines.push(`${histogram.name}_bucket{le="${le}"} ${bucket.count}`);
    }
    lines.push(`${histogram.name}_count ${histogram.count}`);
    lines.push(`${histogram.name}_sum ${histogram.sum}`);
  }

  return lines.join('\n');
}
