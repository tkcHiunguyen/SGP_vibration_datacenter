export async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || text;
  } catch {
    return text;
  }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await readApiError(response));
  const parsed = (await response.json()) as { data?: T } | T;
  return parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data: T }).data : parsed as T;
}

export function fmtCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("vi-VN") : "--";
}

export function fmtBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDateTime(value?: string): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export function fmtDuration(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} giây`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} phút ${rest} giây`;
}
