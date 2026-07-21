import { useEffect } from "react";
import {
  createAppVersionReloadUrl,
  isAppVersionWatcherBusy,
  parseAppVersionManifest,
  setAppVersionWatcherBusy,
  shouldReloadForAppVersion,
} from "../app-version";

const VERSION_CHECK_INTERVAL_MS = 15_000;
const INITIAL_VERSION_CHECK_DELAY_MS = 5_000;

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
    const checkVersion = async () => {
      if (stopped || reloadStarted || document.hidden || isAppVersionWatcherBusy()) {
        return;
      }
      setAppVersionWatcherBusy(true);
      try {
        const response = await fetch(`/app/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
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
        if (!reloadStarted) {
          setAppVersionWatcherBusy(false);
        }
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

    return () => {
      stopped = true;
      setAppVersionWatcherBusy(false);
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
