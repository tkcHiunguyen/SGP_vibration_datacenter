import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  Gauge,
  MapPin,
  Play,
  Ruler,
  Thermometer,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import type { Sensor } from '../data/sensors';
import {
  buildDeviceThresholdUpdate,
  parseThresholdAnalysisJob,
  updateSensorThresholds,
  type ThresholdAnalysisJob,
  type ThresholdAnalysisRow,
  type ThresholdMetric,
} from '../data/threshold-analysis';
import {
  ConfirmModal,
  ConsoleButton,
  ConsoleEmptyState,
  ConsolePage,
  ConsolePageHeader,
  ConsolePanel,
  type ToastItem,
} from './ui';

const JOB_STORAGE_KEY = 'sgp:threshold-analysis-job:v1';
const UNASSIGNED_ZONE = '__unassigned__';
const DAY_OPTIONS = [7, 30, 90] as const;

const METRIC_UI: Record<ThresholdMetric, {
  code: string;
  label: string;
  color: string;
  icon: ReactNode;
}> = {
  temperature: { code: 'TEMP', label: 'Nhiệt độ', color: '#fb7185', icon: <Thermometer size={15} strokeWidth={2.2} /> },
  arms: { code: 'A', label: 'Gia tốc RMS', color: '#38bdf8', icon: <Activity size={15} strokeWidth={2.2} /> },
  vrms: { code: 'V', label: 'Vận tốc RMS', color: '#34d399', icon: <Gauge size={15} strokeWidth={2.2} /> },
  drms: { code: 'D', label: 'Biên độ RMS', color: '#fbbf24', icon: <Ruler size={15} strokeWidth={2.2} /> },
};

const LIGHT_METRIC_COLORS: Record<ThresholdMetric, string> = {
  temperature: '#9f1239',
  arms: '#075985',
  vrms: '#065f46',
  drms: '#92400e',
};

const METRIC_ORDER: ThresholdMetric[] = ['temperature', 'arms', 'vrms', 'drms'];

type ApplyTarget = {
  deviceId: string;
  label: string;
  rows: ThresholdAnalysisRow[];
};

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.data as T;
}

function active(job: ThresholdAnalysisJob | null): boolean {
  return job?.status === 'queued' || job?.status === 'running';
}

function formatNumber(value?: number, maximumFractionDigits = 3): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('vi-VN', { maximumFractionDigits })
    : '--';
}

function formatUnit(unit: string): string {
  return unit.replace('m/s2', 'm/s²').replace('degC', '°C');
}

function sensorAssignment(sensor?: Sensor, row?: ThresholdAnalysisRow): string {
  const parts = [...new Set([
    sensor?.site && sensor.site !== '--' ? sensor.site : row?.system,
    sensor?.zoneCode || row?.zone,
  ].filter((item): item is string => Boolean(item?.trim())).map((item) => item.trim()))];
  return parts.join(' - ') || 'Chưa gán';
}

function rowsByDevice(rows: ThresholdAnalysisRow[]): Array<{ deviceId: string; rows: ThresholdAnalysisRow[] }> {
  const groups = new Map<string, ThresholdAnalysisRow[]>();
  for (const row of rows) groups.set(row.deviceId, [...(groups.get(row.deviceId) ?? []), row]);
  return [...groups.entries()].map(([deviceId, deviceRows]) => ({
    deviceId,
    rows: [...deviceRows].sort((left, right) => METRIC_ORDER.indexOf(left.metric) - METRIC_ORDER.indexOf(right.metric)),
  }));
}

function densityPosition(value: number | undefined, from: number | undefined, to: number | undefined): number | undefined {
  if (value === undefined || from === undefined || to === undefined || to <= from) return undefined;
  return Math.max(0, Math.min(100, (value - from) * 100 / (to - from)));
}

export function ThresholdAnalysisPage({
  sensors,
  onNotify,
  onSensorUpdated,
}: {
  sensors: Sensor[];
  onNotify: (message: Omit<ToastItem, 'id'>) => void;
  onSensorUpdated?: (sensor: Sensor) => void;
}) {
  const { C, theme } = useTheme();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [zoneFilter, setZoneFilter] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [includeSim, setIncludeSim] = useState(false);
  const [job, setJob] = useState<ThresholdAnalysisJob | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [applyTarget, setApplyTarget] = useState<ApplyTarget | null>(null);
  const [applySaving, setApplySaving] = useState(false);

  const eligibleSensors = useMemo(
    () => sensors.filter((sensor) => includeSim || !sensor.id.toUpperCase().startsWith('SIM-')),
    [includeSim, sensors],
  );
  const zones = useMemo(() => {
    const values = new Set(eligibleSensors.map((sensor) => sensor.zoneCode || UNASSIGNED_ZONE));
    return [...values].sort((left, right) => left.localeCompare(right, 'vi'));
  }, [eligibleSensors]);
  const zoneSensors = useMemo(
    () => eligibleSensors.filter((sensor) => zoneFilter === 'all'
      || (zoneFilter === UNASSIGNED_ZONE ? !sensor.zoneCode : sensor.zoneCode === zoneFilter)),
    [eligibleSensors, zoneFilter],
  );
  const targetSensors = useMemo(
    () => zoneSensors.filter((sensor) => deviceFilter === 'all' || sensor.id === deviceFilter),
    [deviceFilter, zoneSensors],
  );
  const sensorMap = useMemo(() => new Map(sensors.map((sensor) => [sensor.id, sensor])), [sensors]);
  const resultGroups = useMemo(() => rowsByDevice(job?.results ?? []), [job?.results]);

  useEffect(() => {
    if (deviceFilter !== 'all' && !zoneSensors.some((sensor) => sensor.id === deviceFilter)) {
      setDeviceFilter('all');
    }
  }, [deviceFilter, zoneSensors]);

  useEffect(() => {
    let jobId = '';
    try { jobId = window.localStorage.getItem(JOB_STORAGE_KEY) || ''; } catch { jobId = ''; }
    if (!jobId) return;
    void requestData<unknown>(`/api/analysis/threshold-jobs/${encodeURIComponent(jobId)}`)
      .then((payload) => {
        const parsed = parseThresholdAnalysisJob(payload);
        if (parsed) setJob(parsed);
      })
      .catch(() => {
        try { window.localStorage.removeItem(JOB_STORAGE_KEY); } catch { /* noop */ }
      });
  }, []);

  useEffect(() => {
    if (!job || !active(job)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const payload = await requestData<unknown>(`/api/analysis/threshold-jobs/${encodeURIComponent(job.jobId)}`);
        if (cancelled) return;
        const parsed = parseThresholdAnalysisJob(payload);
        if (!parsed) throw new Error('analysis_job_invalid');
        setJob(parsed);
        setError('');
        if (active(parsed)) timer = window.setTimeout(poll, 900);
      } catch (pollError) {
        if (cancelled) return;
        setError(`Không đọc được tiến trình: ${safeMessage(pollError)}`);
        timer = window.setTimeout(poll, 2500);
      }
    };
    timer = window.setTimeout(poll, 400);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.jobId, job?.status]);

  async function startAnalysis(): Promise<void> {
    if (starting || active(job) || targetSensors.length === 0) return;
    setStarting(true);
    setError('');
    try {
      const payload = await requestData<unknown>('/api/analysis/threshold-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days, includeSim, deviceIds: targetSensors.map((sensor) => sensor.id) }),
      });
      const parsed = parseThresholdAnalysisJob(payload);
      if (!parsed) throw new Error('analysis_job_invalid');
      setJob(parsed);
      try { window.localStorage.setItem(JOB_STORAGE_KEY, parsed.jobId); } catch { /* noop */ }
    } catch (startError) {
      const message = `Không bắt đầu được phân tích: ${safeMessage(startError)}`;
      setError(message);
      onNotify({ type: 'warning', title: 'Phân tích thất bại', text: message });
    } finally {
      setStarting(false);
    }
  }

  async function applySuggestedThresholds(): Promise<void> {
    if (!applyTarget || applySaving) return;
    const sensor = sensorMap.get(applyTarget.deviceId);
    if (!sensor) {
      setError('Thiết bị không còn trong danh sách hiện tại.');
      return;
    }
    const update = buildDeviceThresholdUpdate(applyTarget.rows);
    if (Object.keys(update).length === 0) {
      setError('Không có ngưỡng hợp lệ để áp dụng.');
      return;
    }
    setApplySaving(true);
    setError('');
    try {
      await requestData<unknown>(`/api/devices/${encodeURIComponent(applyTarget.deviceId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      onSensorUpdated?.(updateSensorThresholds(sensor, update));
      setJob((current) => current ? {
        ...current,
        results: current.results.filter((row) => row.deviceId !== applyTarget.deviceId),
      } : current);
      onNotify({ type: 'success', title: 'Đã áp dụng ngưỡng', text: `${applyTarget.label}: các ngưỡng hợp lệ đã được cập nhật.` });
      setApplyTarget(null);
    } catch (applyError) {
      const message = `Không áp dụng được ngưỡng: ${safeMessage(applyError)}`;
      setError(message);
      onNotify({ type: 'warning', title: 'Áp dụng thất bại', text: message });
    } finally {
      setApplySaving(false);
    }
  }

  const activeRun = active(job);

  return (
    <ConsolePage className="threshold-analysis-page p-4" style={{ minHeight: '100%', boxSizing: 'border-box' }}>
      <ConsolePageHeader
        icon={<BarChart3 size={19} strokeWidth={2.2} />}
        title="Phân tích & đề xuất ngưỡng"
        subtitle="Đọc toàn bộ telemetry gốc trong khoảng đã chọn, không lấy mẫu và không gộp theo thời gian."
        actions={(
          <div className="analysis-runtime-note" style={{ color: C.textMuted }}>
            <Database size={13} color={C.primary} />
            <span>Node.js job</span>
            <span aria-hidden="true">·</span>
            <strong style={{ color: C.textBright }}>toàn bộ bản ghi</strong>
          </div>
        )}
      />

      <ConsolePanel className="analysis-config-panel">
        <div className="analysis-config-head" style={{ borderColor: C.border }}>
          <div>
            <h3 style={{ color: C.textBright }}>Thiết lập job</h3>
            <p style={{ color: C.textMuted }}>Chỉ chạy khi bấm bắt đầu; các bộ lọc không tự gửi yêu cầu.</p>
          </div>
          <div className="analysis-target-count" style={{ color: C.textMuted }}>
            <strong style={{ color: C.textBright }}>{targetSensors.length.toLocaleString('vi-VN')}</strong>
            <span>thiết bị</span>
          </div>
        </div>

        <div className="analysis-control-grid">
          <fieldset className="analysis-range-field">
            <legend style={{ color: C.textMuted }}>Khoảng dữ liệu</legend>
            <div className="analysis-range-group" aria-label="Khoảng dữ liệu phân tích">
              {DAY_OPTIONS.map((option) => {
                const selected = days === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDays(option)}
                    disabled={activeRun}
                    style={{
                      borderColor: selected ? C.primary : C.border,
                      background: selected ? C.primaryBg : C.input,
                      color: selected ? C.primary : C.textBase,
                    }}
                  >
                    <strong>{option}</strong>
                    <span>ngày</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="analysis-field">
            <span style={{ color: C.textMuted }}>Khu vực</span>
            <select
              className="analysis-select"
              aria-label="Lọc khu vực phân tích"
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
              disabled={activeRun}
              style={{ color: C.textBright, borderColor: C.border, background: C.input }}
            >
              <option value="all">Tất cả khu vực</option>
              {zones.map((zone) => <option key={zone} value={zone}>{zone === UNASSIGNED_ZONE ? 'Chưa gán' : zone}</option>)}
            </select>
          </label>

          <label className="analysis-field">
            <span style={{ color: C.textMuted }}>Thiết bị</span>
            <select
              className="analysis-select"
              aria-label="Lọc thiết bị phân tích"
              value={deviceFilter}
              onChange={(event) => setDeviceFilter(event.target.value)}
              disabled={activeRun}
              style={{ color: C.textBright, borderColor: C.border, background: C.input }}
            >
              <option value="all">Tất cả thiết bị ({zoneSensors.length})</option>
              {zoneSensors.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>{sensor.name} — {sensorAssignment(sensor)}</option>
              ))}
            </select>
          </label>

          <label className="analysis-sim-option" title="Mặc định tắt để dữ liệu vận hành không bị nhiễu">
            <input
              type="checkbox"
              checked={includeSim}
              onChange={(event) => setIncludeSim(event.target.checked)}
              disabled={activeRun}
              style={{ accentColor: C.primary }}
            />
            <span style={{ color: C.textBase }}>Gồm thiết bị giả lập</span>
          </label>

          <ConsoleButton
            className="analysis-run-button"
            variant="primary"
            onClick={() => void startAnalysis()}
            disabled={starting || activeRun || targetSensors.length === 0}
          >
            <Play size={15} fill="currentColor" />
            {starting ? 'Đang tạo job...' : activeRun ? 'Đang phân tích...' : 'Bắt đầu phân tích'}
          </ConsoleButton>
        </div>

        <div className="analysis-run-facts" style={{ color: C.textMuted, borderColor: C.border }}>
          <span>Đọc đủ từng bản ghi</span>
          <span>Batch 5.000</span>
          <span>Không bucket thời gian</span>
          <span>Lọc trung vị 3 mẫu</span>
          <span>Ngưỡng = mật độ cao nhất + 10%</span>
        </div>
      </ConsolePanel>

      {error ? (
        <div role="alert" className="analysis-inline-error" style={{ borderColor: `${C.danger}66`, background: C.dangerBg, color: C.danger }}>
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      {job ? (
        <ConsolePanel className="analysis-progress-panel">
          <div className="analysis-progress-head">
            <div>
              <span style={{ color: job.status === 'failed' ? C.danger : job.status === 'completed' ? C.success : C.primary }}>
                {job.status === 'completed' ? <CheckCircle2 size={17} /> : job.status === 'failed' ? <AlertTriangle size={17} /> : <Database size={17} />}
              </span>
              <div>
                <strong style={{ color: C.textBright }}>{job.stage || 'Đang chuẩn bị'}</strong>
                <small style={{ color: C.textMuted }}>{job.completedDevices}/{job.totalDevices} thiết bị · {job.days} ngày</small>
              </div>
            </div>
            <strong className="tabular-nums" style={{ color: C.textBright }}>{formatNumber(job.progress, 0)}%</strong>
          </div>
          <div className="analysis-progress-track" style={{ background: C.input }}>
            <div style={{ width: `${Math.max(0, Math.min(100, job.progress))}%`, background: job.status === 'failed' ? C.danger : C.success }} />
          </div>

          <div className="analysis-device-progress">
            {Object.values(job.devices).map((device) => (
              <div key={device.deviceId} style={{ borderColor: C.border, background: C.surface }}>
                <span style={{ color: device.status === 'failed' ? C.danger : device.status === 'completed' ? C.success : device.status === 'running' ? C.primary : C.textMuted }}>
                  {device.status === 'failed' ? <AlertTriangle size={14} /> : device.status === 'completed' ? <CheckCircle2 size={14} /> : <Database size={14} />}
                </span>
                <strong title={device.label} style={{ color: C.textBase }}>{device.label}</strong>
                <small className="tabular-nums" style={{ color: C.textMuted }}>
                  {device.status === 'running'
                    ? `${formatNumber(device.processedRows, 0)} / ${formatNumber(device.totalRows, 0)} bản ghi`
                    : device.status === 'completed'
                      ? `${device.availableMetrics ?? 0}/4 · ${formatNumber(device.processedRows, 0)} bản ghi`
                      : device.status === 'failed' ? 'Lỗi' : 'Chờ'}
                </small>
              </div>
            ))}
          </div>

          {job.events.length > 0 ? (
            <div className="analysis-log" style={{ borderColor: C.border, background: C.input }} aria-live="polite">
              {job.events.slice(-24).map((event, index) => (
                <div key={`${event.at}-${index}`} style={{ color: event.level === 'error' ? C.danger : event.level === 'success' ? C.success : C.textMuted }}>
                  <time>{new Date(event.at).toLocaleTimeString('vi-VN')}</time>
                  <span>{event.message}</span>
                </div>
              ))}
            </div>
          ) : null}
        </ConsolePanel>
      ) : null}

      {!job ? (
        <ConsolePanel>
          <ConsoleEmptyState
            icon={<BarChart3 size={28} />}
            title="Chưa có kết quả"
            description="Chọn phạm vi ở trên rồi bấm Bắt đầu phân tích. Không có ngưỡng nào được tự động áp dụng."
          />
        </ConsolePanel>
      ) : null}

      {resultGroups.length > 0 ? (
        <div className="analysis-results">
          {resultGroups.map(({ deviceId, rows }) => {
            const sensor = sensorMap.get(deviceId);
            const first = rows[0];
            const label = sensor?.name || first?.deviceName || first?.deviceLabel || deviceId;
            const assignment = sensorAssignment(sensor, first);
            const validSuggestions = Object.keys(buildDeviceThresholdUpdate(rows)).length;
            return (
              <ConsolePanel key={deviceId} className="analysis-device-result">
                <div className="analysis-result-head" style={{ borderColor: C.border }}>
                  <div>
                    <strong style={{ color: C.textBright }}>{label}</strong>
                    <span style={{ color: C.textMuted }}><MapPin size={13} /> {assignment}</span>
                  </div>
                  <ConsoleButton
                    size="sm"
                    variant="primary"
                    disabled={validSuggestions === 0}
                    onClick={() => setApplyTarget({ deviceId, label: `${label} - ${assignment}`, rows })}
                  >
                    Áp dụng ngưỡng đề xuất ({validSuggestions})
                  </ConsoleButton>
                </div>

                <div className="analysis-table-header" style={{ color: C.textMuted, borderColor: C.border }}>
                  <span>Chỉ số</span><span>Bản ghi</span><span>Mật độ</span><span>P95 lọc</span><span>P99 lọc</span><span>Hiện tại</span><span>Đề xuất</span><span>Chênh lệch</span>
                </div>
                <div className="analysis-metric-list">
                  {rows.map((row) => {
                    const ui = METRIC_UI[row.metric];
                    const metricColor = theme === 'light' ? LIGHT_METRIC_COLORS[row.metric] : ui.color;
                    const suggested = row.suggestedThreshold;
                    const current = row.currentThreshold;
                    const difference = typeof suggested === 'number' && typeof current === 'number' ? suggested - current : undefined;
                    const isOk = row.status === 'ok';
                    const densityMax = Math.max(0, ...(row.densityBins ?? []));
                    const currentPosition = densityPosition(current, row.densityFrom, row.densityTo);
                    const suggestedPosition = densityPosition(suggested, row.densityFrom, row.densityTo);
                    return (
                      <article key={row.metric} className="analysis-metric-row" style={{ borderColor: C.border }}>
                        <div className="analysis-metric-name">
                          <span style={{ color: metricColor, borderColor: `${metricColor}66`, background: `${metricColor}12` }}>{ui.icon}</span>
                          <div>
                            <strong style={{ color: C.textBright }}>{ui.label}</strong>
                            <small style={{ color: metricColor }}>{ui.code} · {formatUnit(row.unit)}</small>
                          </div>
                          <em style={{ color: row.status === 'error' ? C.danger : isOk ? C.success : C.warning }}>
                            {row.status === 'error' ? 'Lỗi' : isOk ? 'Đủ dữ liệu' : 'Thiếu dữ liệu'}
                          </em>
                        </div>
                        {row.status === 'error' ? (
                          <div className="analysis-row-error" style={{ color: C.danger }}>{row.error || 'Phân tích thiết bị thất bại'}</div>
                        ) : (
                          <>
                            <div className="analysis-data-cell"><span>Bản ghi</span><strong style={{ color: C.textBright }}>{formatNumber(row.dataPoints, 0)}</strong></div>
                            <div className="analysis-data-cell analysis-density-cell">
                              <span>Mật độ</span>
                              {isOk && row.densityBins?.length ? (
                                <div className="analysis-density">
                                  <div
                                    className="analysis-density-strip"
                                    role="img"
                                    aria-label={`Phân bố từ ${formatNumber(row.densityFrom)} đến ${formatNumber(row.densityTo)} ${formatUnit(row.unit)}`}
                                    style={{ background: C.input }}
                                  >
                                    {row.densityBins.map((share, index) => (
                                      <i
                                        key={index}
                                        style={{ background: metricColor, opacity: densityMax > 0 ? 0.12 + share / densityMax * 0.88 : 0.12 }}
                                      />
                                    ))}
                                    {currentPosition !== undefined ? <b title={`Ngưỡng hiện tại: ${formatNumber(current)}`} style={{ left: `${currentPosition}%`, background: C.warning }} /> : null}
                                    {suggestedPosition !== undefined ? <b title={`Ngưỡng đề xuất: ${formatNumber(suggested)}`} style={{ left: `${suggestedPosition}%`, background: metricColor }} /> : null}
                                  </div>
                                  <small style={{ color: C.textMuted }}>{formatNumber(row.popularFrom)}–{formatNumber(row.popularTo)} · {formatNumber(row.popularSharePercent, 1)}%</small>
                                </div>
                              ) : <strong style={{ color: C.textBright }}>--</strong>}
                            </div>
                            <div className="analysis-data-cell"><span>P95</span><strong style={{ color: C.textBright }}>{formatNumber(row.p95)}</strong></div>
                            <div className="analysis-data-cell"><span>P99</span><strong style={{ color: C.textBright }}>{formatNumber(row.p99)}</strong></div>
                            <div className="analysis-data-cell"><span>Hiện tại</span><strong style={{ color: C.textBase }}>{formatNumber(current)}</strong></div>
                            <div className="analysis-data-cell"><span>Đề xuất</span><strong style={{ color: isOk ? metricColor : C.textMuted }}>{formatNumber(suggested)}</strong></div>
                            <div className="analysis-data-cell"><span>Chênh lệch</span><strong style={{ color: typeof difference === 'number' && difference > 0 ? C.warning : C.success }}>{typeof difference === 'number' && difference > 0 ? '+' : ''}{formatNumber(difference)}</strong></div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              </ConsolePanel>
            );
          })}
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(applyTarget)}
        onClose={() => { if (!applySaving) setApplyTarget(null); }}
        onConfirm={() => void applySuggestedThresholds()}
        title="Áp dụng ngưỡng đề xuất"
        confirmLabel={applySaving ? 'Đang áp dụng...' : 'Áp dụng ngưỡng'}
        busy={applySaving}
        confirmDisabled={!applyTarget || Object.keys(buildDeviceThresholdUpdate(applyTarget.rows)).length === 0}
        description={applyTarget ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ color: C.textBase }}>Thiết bị <strong style={{ color: C.textBright }}>{applyTarget.label}</strong></div>
            <div style={{ display: 'grid', gap: 7 }}>
              {applyTarget.rows.filter((row) => row.status === 'ok' && typeof row.suggestedThreshold === 'number' && row.suggestedThreshold > 0).map((row) => {
                const ui = METRIC_UI[row.metric];
                const metricColor = theme === 'light' ? LIGHT_METRIC_COLORS[row.metric] : ui.color;
                return (
                  <div key={row.metric} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) auto', gap: 12, padding: '7px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface }}>
                    <span style={{ color: metricColor, fontWeight: 800 }}>{ui.label}</span>
                    <span className="tabular-nums" style={{ color: C.textMuted }}>
                      {formatNumber(row.currentThreshold)} → <strong style={{ color: C.textBright }}>{formatNumber(row.suggestedThreshold)} {formatUnit(row.unit)}</strong>
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ color: C.warning, fontSize: '0.75rem' }}>Chỉ bốn trường ngưỡng hợp lệ được gửi; thông tin thiết bị khác được giữ nguyên.</div>
          </div>
        ) : ''}
      />

      <style>{`
        .threshold-analysis-page { width: 100%; max-width: 1540px; margin: 0 auto; }
        .threshold-analysis-page h1, .threshold-analysis-page h2, .threshold-analysis-page h3 { text-wrap: balance; }
        .threshold-analysis-page p { text-wrap: pretty; }
        .analysis-runtime-note { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; }
        .analysis-runtime-note strong { font-size: inherit; }
        .analysis-config-panel { overflow: hidden; }
        .analysis-config-head { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; border-bottom: 1px solid; }
        .analysis-config-head > div:first-child { display: grid; gap: 3px; }
        .analysis-config-head h3 { margin: 0; font-size: 0.78rem; font-weight: 820; }
        .analysis-config-head p { margin: 0; font-size: 0.75rem; }
        .analysis-target-count { display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
        .analysis-target-count strong { font-size: 1rem; font-variant-numeric: tabular-nums; }
        .analysis-target-count span { font-size: 0.75rem; }
        .analysis-control-grid { display: grid; grid-template-columns: 220px minmax(140px, 0.7fr) minmax(260px, 1.35fr) auto auto; align-items: end; gap: 10px; padding: 14px; }
        .analysis-range-field { min-width: 0; margin: 0; padding: 0; border: 0; }
        .analysis-range-field legend, .analysis-field > span { display: block; margin: 0 0 6px; padding: 0; font-size: 0.75rem; font-weight: 780; }
        .analysis-range-group { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .analysis-range-group button { min-height: 40px; display: flex; align-items: center; justify-content: center; gap: 4px; margin-left: -1px; border: 1px solid; border-radius: 0; cursor: pointer; font: inherit; transition: border-color 150ms ease-out, background 150ms ease-out, color 150ms ease-out; }
        .analysis-range-group button:first-child { margin-left: 0; border-radius: 7px 0 0 7px; }
        .analysis-range-group button:last-child { border-radius: 0 7px 7px 0; }
        .analysis-range-group button strong { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
        .analysis-range-group button span { font-size: 0.75rem; }
        .analysis-range-group button:disabled { cursor: not-allowed; opacity: 0.55; }
        .analysis-field { display: grid; gap: 6px; min-width: 0; }
        .analysis-select { width: 100%; min-width: 0; height: 40px; padding: 0 10px; border: 1px solid; border-radius: 7px; outline: 0; font: inherit; font-size: 0.75rem; font-weight: 680; cursor: pointer; }
        .analysis-select:focus-visible { border-color: ${C.primary}; outline: 2px solid ${C.primary}33; outline-offset: 1px; }
        .analysis-select:disabled { cursor: not-allowed; opacity: 0.55; }
        .analysis-sim-option { min-height: 40px; display: inline-flex; align-items: center; gap: 7px; padding-bottom: 1px; cursor: pointer; white-space: nowrap; }
        .analysis-sim-option input { width: 15px; height: 15px; margin: 0; cursor: pointer; }
        .analysis-sim-option span { font-size: 0.75rem; font-weight: 700; }
        .analysis-run-button { min-height: 40px; white-space: nowrap; }
        .analysis-run-facts { display: flex; align-items: center; gap: 0; padding: 8px 14px; border-top: 1px solid; font-size: 0.75rem; }
        .analysis-run-facts span { display: inline-flex; align-items: center; }
        .analysis-run-facts span + span::before { content: '·'; margin: 0 8px; opacity: 0.6; }
        .analysis-inline-error { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid; border-radius: 9px; font-size: 0.75rem; font-weight: 750; }
        .analysis-progress-panel { padding: 16px; }
        .analysis-progress-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .analysis-progress-head > div { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .analysis-progress-head > div > div { display: grid; gap: 3px; min-width: 0; }
        .analysis-progress-head strong { font-size: 0.76rem; }
        .analysis-progress-head small { font-size: 0.75rem; }
        .analysis-progress-track { height: 5px; margin-top: 12px; overflow: hidden; border-radius: 999px; }
        .analysis-progress-track > div { height: 100%; }
        .analysis-device-progress { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 7px; margin-top: 12px; }
        .analysis-device-progress > div { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px; min-width: 0; padding: 8px 9px; border: 1px solid; border-radius: 8px; }
        .analysis-device-progress strong { overflow: hidden; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
        .analysis-device-progress small { font-size: 0.75rem; white-space: nowrap; }
        .analysis-log { max-height: 142px; display: grid; gap: 5px; margin-top: 12px; padding: 9px 11px; overflow: auto; border: 1px solid; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; }
        .analysis-log > div { display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 8px; }
        .analysis-log time { opacity: 0.7; font-variant-numeric: tabular-nums; }
        .analysis-results { display: grid; gap: 12px; }
        .analysis-device-result { overflow: hidden; }
        .analysis-result-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 15px; border-bottom: 1px solid; }
        .analysis-result-head > div { display: grid; gap: 4px; min-width: 0; }
        .analysis-result-head strong { font-size: 0.84rem; }
        .analysis-result-head span { display: flex; align-items: center; gap: 5px; font-size: 0.75rem; }
        .analysis-table-header, .analysis-metric-row { display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(82px, 0.6fr) minmax(180px, 1.25fr) repeat(5, minmax(76px, 0.55fr)); align-items: center; }
        .analysis-table-header { min-height: 35px; padding: 0 14px; border-bottom: 1px solid; font-size: 0.75rem; font-weight: 820; text-transform: uppercase; }
        .analysis-table-header span:not(:first-child) { text-align: right; }
        .analysis-metric-list { display: grid; }
        .analysis-metric-row { min-height: 72px; padding: 9px 14px; border-bottom: 1px solid; }
        .analysis-metric-row:last-child { border-bottom: 0; }
        .analysis-metric-name { display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; }
        .analysis-metric-name > span { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid; border-radius: 8px; }
        .analysis-metric-name > div { display: grid; gap: 2px; min-width: 0; }
        .analysis-metric-name strong { overflow: hidden; font-size: 0.75rem; text-overflow: ellipsis; white-space: nowrap; }
        .analysis-metric-name small { font-size: 0.75rem; font-weight: 800; }
        .analysis-metric-name em { grid-column: 2; font-size: 0.75rem; font-style: normal; font-weight: 750; }
        .analysis-data-cell { display: grid; justify-items: end; gap: 3px; min-width: 0; }
        .analysis-data-cell > span { display: none; }
        .analysis-data-cell strong { font-size: 0.75rem; font-variant-numeric: tabular-nums; }
        .analysis-data-cell small { font-size: 0.75rem; }
        .analysis-density-cell { justify-items: stretch; }
        .analysis-density { width: 100%; display: grid; gap: 4px; }
        .analysis-density-strip { position: relative; height: 22px; display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 1px; padding: 2px; overflow: hidden; border-radius: 5px; }
        .analysis-density-strip > i { min-width: 0; border-radius: 2px; }
        .analysis-density-strip > b { position: absolute; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); }
        .analysis-density small { text-align: left; font-variant-numeric: tabular-nums; }
        .analysis-row-error { grid-column: 2 / -1; padding-left: 12px; font-size: 0.75rem; }
        @media (max-width: 1050px) {
          .analysis-control-grid { grid-template-columns: 220px minmax(140px, 0.8fr) minmax(260px, 1.2fr); }
          .analysis-sim-option { grid-column: 1 / 3; }
          .analysis-run-button { grid-column: 3; grid-row: 2; }
          .analysis-table-header { display: none; }
          .analysis-metric-row { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 16px; align-items: start; padding: 12px 14px; }
          .analysis-metric-name { grid-column: 1 / -1; }
          .analysis-data-cell { grid-template-columns: minmax(74px, 1fr) auto; align-items: baseline; justify-items: stretch; gap: 8px; }
          .analysis-data-cell > span { display: block; color: ${C.textMuted}; font-size: 0.75rem; }
          .analysis-data-cell strong, .analysis-data-cell small { text-align: right; }
          .analysis-data-cell small { grid-column: 1 / -1; }
          .analysis-density small { grid-column: auto; text-align: left; }
          .analysis-row-error { grid-column: 1 / -1; padding: 0; }
        }
        @media (max-width: 680px) {
          .threshold-analysis-page { padding: 10px !important; }
          .analysis-runtime-note { width: 100%; justify-content: center; }
          .analysis-config-head { align-items: flex-start; }
          .analysis-control-grid { grid-template-columns: 1fr; padding: 12px; }
          .analysis-sim-option, .analysis-run-button { grid-column: 1; grid-row: auto; }
          .analysis-run-button { width: 100%; }
          .analysis-run-facts { flex-wrap: wrap; row-gap: 5px; }
          .analysis-result-head { align-items: stretch; flex-direction: column; }
          .analysis-result-head button { width: 100%; }
          .analysis-metric-row { grid-template-columns: 1fr; }
          .analysis-metric-name, .analysis-row-error { grid-column: 1; }
          .analysis-device-progress { grid-template-columns: 1fr; }
          .analysis-device-progress > div { grid-template-columns: auto minmax(0, 1fr); }
          .analysis-device-progress small { grid-column: 2; }
        }
        @media (prefers-reduced-motion: reduce) {
          .analysis-range-group button { transition: none; }
        }
      `}</style>
    </ConsolePage>
  );
}
