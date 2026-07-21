import { useEffect } from "react";

const DISPLAY_CLIENT_ID_STORAGE_KEY = "sgp:display-client-id:v1";
const CAPTURE_DELAY_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDisplayClientId(): string {
  try {
    const stored = window.localStorage.getItem(DISPLAY_CLIENT_ID_STORAGE_KEY)?.trim();
    if (stored && UUID_PATTERN.test(stored)) {
      return stored;
    }
    const created = window.crypto.randomUUID();
    window.localStorage.setItem(DISPLAY_CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return window.crypto.randomUUID();
  }
}

async function captureAndUploadDisplay(): Promise<void> {
  if (document.hidden) {
    return;
  }

  await document.fonts?.ready;
  const { domToBlob } = await import("modern-screenshot");
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const target = document.querySelector<HTMLElement>(".dc-app-shell") ?? document.body;
  const image = await domToBlob(target, {
    width: viewportWidth,
    height: viewportHeight,
    type: "image/jpeg",
    quality: 0.82,
    scale: 1,
    backgroundColor: window.getComputedStyle(document.body).backgroundColor || "#07111d",
    features: { restoreScrollPosition: true },
  });
  const clientId = getDisplayClientId();
  const platform = navigator.platform?.trim() || "Browser";
  const displayName = `${platform} ${window.screen.width}x${window.screen.height} - ${clientId.slice(0, 8)}`;
  const form = new FormData();
  form.append("file", image, "display.jpg");

  const response = await fetch(`/api/display-clients/${encodeURIComponent(clientId)}/screenshot`, {
    method: "POST",
    headers: {
      "x-display-name": displayName,
      "x-captured-at": new Date().toISOString(),
      "x-viewport-width": String(viewportWidth),
      "x-viewport-height": String(viewportHeight),
      "x-device-pixel-ratio": String(window.devicePixelRatio || 1),
      "x-page-path": `${window.location.pathname}${window.location.search}`,
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`display_screenshot_upload_failed_${response.status}`);
  }
}

export function DisplayScreenshotReporter() {
  useEffect(() => {
    let captured = false;
    let timer: number | null = null;

    const scheduleCapture = (delayMs: number) => {
      if (captured || document.hidden || timer !== null) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        if (captured || document.hidden) {
          return;
        }
        captured = true;
        void captureAndUploadDisplay().catch((error) => {
          console.warn("Unable to upload display screenshot", error);
        });
      }, delayMs);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        scheduleCapture(1_000);
      }
    };

    scheduleCapture(CAPTURE_DELAY_MS);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return null;
}
