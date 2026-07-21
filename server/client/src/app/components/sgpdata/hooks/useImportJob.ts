import { useCallback, useEffect, useState } from "react";

import { requestJson } from "../api";
import type { ImportJob } from "../types";

export const IMPORT_JOB_STORAGE_KEY = "sgp:data-import-job";

function isActive(job: ImportJob | null): boolean {
  return job?.status === "queued" || job?.status === "running" || job?.status === "validating";
}

function sortJobs(jobs: ImportJob[]): ImportJob[] {
  return [...jobs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function useImportJob() {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [history, setHistory] = useState<ImportJob[]>([]);
  const [pollError, setPollError] = useState("");

  const refreshHistory = useCallback(async () => {
    const response = await requestJson<{ items?: ImportJob[] }>("/api/sgpdata/import/jobs?limit=20");
    setHistory(sortJobs(response.items ?? []));
  }, []);

  const track = useCallback((next: ImportJob) => {
    setJob(next);
    setHistory((current) => sortJobs([next, ...current.filter((item) => item.jobId !== next.jobId)]).slice(0, 20));
    try {
      window.localStorage.setItem(IMPORT_JOB_STORAGE_KEY, next.jobId);
    } catch {
      // The persistent server job still works if browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    let storedId: string | null = null;
    try {
      storedId = window.localStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    } catch {
      storedId = null;
    }
    if (!storedId) {
      void refreshHistory().catch(() => undefined);
      return;
    }
    void requestJson<ImportJob>(`/api/sgpdata/import/jobs/${encodeURIComponent(storedId)}`)
      .then(track)
      .catch(() => {
        try { window.localStorage.removeItem(IMPORT_JOB_STORAGE_KEY); } catch { /* noop */ }
        void refreshHistory().catch(() => undefined);
      });
  }, [refreshHistory, track]);

  useEffect(() => {
    if (!job || !isActive(job)) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await requestJson<ImportJob>(`/api/sgpdata/import/jobs/${encodeURIComponent(job.jobId)}`);
        if (cancelled) return;
        setPollError("");
        track(next);
        if (isActive(next)) {
          timer = window.setTimeout(poll, 1500);
        } else {
          try { window.localStorage.removeItem(IMPORT_JOB_STORAGE_KEY); } catch { /* noop */ }
          void refreshHistory().catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) return;
        setPollError(error instanceof Error ? error.message : "Không đọc được tiến trình import");
        timer = window.setTimeout(poll, 2500);
      }
    };
    timer = window.setTimeout(poll, 700);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.jobId, job?.status, refreshHistory, track]);

  return { job, history, pollError, track, refreshHistory };
}
