import { useEffect } from "react";
import {
  APP_VERSION_CHECK_EVENT,
  createAppVersionReloadUrl,
  parseAppVersionManifest,
  setAppVersionWatcherBusy,
  shouldReloadForAppVersion,
} from "../app-version";

const VERSION_CHECK_INTERVAL_MS = 15_000;
const INITIAL_VERSION_CHECK_DELAY_MS = 1_000;

function getCurrentBuildId(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="sgp-app-build-id"]')?.content.trim() ?? "";
}

export function AppVersionWatcher() {
  useEffect(() => {
    const currentBuildId = getCurrentBuildId();
    if (!currentBuildId) {
      return;
    }

    let stopped = false;
    let reloadStarted = false;
    let checkInFlight = false;
    const checkVersion = async () => {
      if (stopped || reloadStarted || document.hidden || checkInFlight) {
        return;
      }
      checkInFlight = true;
      setAppVersionWatcherBusy(true);
      const controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const response = await fetch(`/app/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const manifest = parseAppVersionManifest(await response.json());
        if (!manifest || !shouldReloadForAppVersion(currentBuildId, manifest.buildId)) {
          return;
        }
        reloadStarted = true;
        window.location.replace(createAppVersionReloadUrl(window.location.href, manifest.buildId));
      } catch {
        // A temporary network failure should not interrupt the wallboard.
      } finally {
        window.clearTimeout(requestTimeout);
        checkInFlight = false;
        setAppVersionWatcherBusy(false);
      }
    };

    const initialTimer = window.setTimeout(() => void checkVersion(), INITIAL_VERSION_CHECK_DELAY_MS);
    const interval = window.setInterval(() => void checkVersion(), VERSION_CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void checkVersion();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener(APP_VERSION_CHECK_EVENT, checkVersion);
    window.addEventListener("online", checkVersion);
    window.addEventListener("pageshow", checkVersion);

    return () => {
      stopped = true;
      setAppVersionWatcherBusy(false);
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(APP_VERSION_CHECK_EVENT, checkVersion);
      window.removeEventListener("online", checkVersion);
      window.removeEventListener("pageshow", checkVersion);
    };
  }, []);

  return null;
}
