import { useCallback, useEffect, useState } from "react";

import { requestJson } from "../api";
import type { ExportJob } from "../types";

const STORAGE_KEY = "sgp:data-export-job";

function active(job: ExportJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function sortJobs(jobs: ExportJob[]): ExportJob[] {
  return [...jobs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function useExportJob() {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [history, setHistory] = useState<ExportJob[]>([]);
  const [pollError, setPollError] = useState("");

  const refreshHistory = useCallback(async () => {
    const response = await requestJson<{ items?: ExportJob[] }>("/api/sgpdata/export/jobs?limit=20");
    setHistory(sortJobs(response.items ?? []));
  }, []);

  const track = useCallback((next: ExportJob) => {
    setJob(next);
    setHistory((current) => sortJobs([next, ...current.filter((item) => item.jobId !== next.jobId)]).slice(0, 20));
    try { window.localStorage.setItem(STORAGE_KEY, next.jobId); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    let storedId: string | null = null;
    try { storedId = window.localStorage.getItem(STORAGE_KEY); } catch { storedId = null; }
    if (!storedId) {
      void refreshHistory().catch(() => undefined);
      return;
    }
    void requestJson<ExportJob>(`/api/sgpdata/export/jobs/${encodeURIComponent(storedId)}`)
      .then(track)
      .catch(() => {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
        void refreshHistory().catch(() => undefined);
      });
  }, [refreshHistory, track]);

  useEffect(() => {
    if (!job || !active(job)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await requestJson<ExportJob>(`/api/sgpdata/export/jobs/${encodeURIComponent(job.jobId)}`);
        if (cancelled) return;
        setPollError("");
        track(next);
        if (active(next)) timer = window.setTimeout(poll, 1500);
        else {
          try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
          void refreshHistory().catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) return;
        setPollError(error instanceof Error ? error.message : "Không đọc được tiến trình export");
        timer = window.setTimeout(poll, 2500);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.jobId, job?.status, refreshHistory, track]);

  return { job, history, pollError, track };
}
