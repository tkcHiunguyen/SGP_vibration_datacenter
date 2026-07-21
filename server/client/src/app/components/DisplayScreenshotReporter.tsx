import { useEffect, useRef } from "react";
import { domToBlob } from "modern-screenshot";
import { isAppVersionWatcherBusy } from "../app-version";

const DISPLAY_CLIENT_ID_STORAGE_KEY = "sgp:display-client-id:v1";
const CAPTURE_DELAY_MS = 8_000;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ScreenshotState = "idle" | "capturing" | "uploading" | "succeeded" | "retry-wait";
type ScreenshotStage = "identity" | "capture" | "upload";

type CryptoSource = {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
};

class DisplayScreenshotError extends Error {
  constructor(
    message: string,
    readonly stage: ScreenshotStage,
    readonly status?: number,
    readonly serverError?: string,
    readonly blobSize?: number,
  ) {
    super(message);
    this.name = "DisplayScreenshotError";
  }
}

export function createUuidV4(cryptoSource?: CryptoSource): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoSource?.getRandomValues === "function") {
    cryptoSource.getRandomValues(bytes);
  } else {
    let seed = Date.now();
    for (let index = 0; index < bytes.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      bytes[index] = (seed ^ Math.floor(Math.random() * 256)) & 0xff;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function getScreenshotRetryDelay(attemptIndex: number): number | null {
  return RETRY_DELAYS_MS[attemptIndex] ?? null;
}

export function isRetryableScreenshotStatus(status?: number): boolean {
  return status === undefined || status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableScreenshotError(error: unknown): boolean {
  return !(error instanceof DisplayScreenshotError) || isRetryableScreenshotStatus(error.status);
}

function getDisplayClientId(): string {
  try {
    const stored = window.localStorage.getItem(DISPLAY_CLIENT_ID_STORAGE_KEY)?.trim();
    if (stored && UUID_PATTERN.test(stored)) return stored;
  } catch {
    // Storage can be unavailable in private kiosk sessions.
  }

  const created = createUuidV4(window.crypto as CryptoSource | undefined);
  try {
    window.localStorage.setItem(DISPLAY_CLIENT_ID_STORAGE_KEY, created);
  } catch {
    // A stable ID for the current page is still enough to upload the screenshot.
  }
  return created;
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function screenshotNodeFilter(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  if (node.tagName === "IFRAME" || node.tagName === "VIDEO") return false;
  if (node.tagName === "CANVAS" && node.closest(".motor-scene-canvas")) return false;
  return true;
}

async function captureDisplay(): Promise<{
  image: Blob;
  clientId: string;
  displayName: string;
  viewportWidth: number;
  viewportHeight: number;
}> {
  let clientId: string;
  try {
    clientId = getDisplayClientId();
  } catch (error) {
    throw new DisplayScreenshotError(String(error), "identity");
  }

  await Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 2_500)),
  ]);
  await waitForNextPaint();
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const target = document.querySelector<HTMLElement>(".dc-app-shell") ?? document.body;

  let image: Blob;
  try {
    image = await domToBlob(target, {
      width: viewportWidth,
      height: viewportHeight,
      type: "image/jpeg",
      quality: 0.82,
      scale: 1,
      backgroundColor: window.getComputedStyle(document.body).backgroundColor || "#07111d",
      features: { restoreScrollPosition: true },
      filter: screenshotNodeFilter,
    });
  } catch (error) {
    throw new DisplayScreenshotError(String(error), "capture");
  }
  if (image.size <= 0 || image.type !== "image/jpeg") {
    throw new DisplayScreenshotError("display_screenshot_blob_invalid", "capture", undefined, undefined, image.size);
  }

  const platform = navigator.platform?.trim() || "Browser";
  const displayName = `${platform} ${window.screen.width}x${window.screen.height} - ${clientId.slice(0, 8)}`;
  return { image, clientId, displayName, viewportWidth, viewportHeight };
}

async function uploadDisplayScreenshot(capture: Awaited<ReturnType<typeof captureDisplay>>): Promise<void> {
  const form = new FormData();
  form.append("file", capture.image, "display.jpg");
  let response: Response;
  try {
    response = await fetch(`/api/display-clients/${encodeURIComponent(capture.clientId)}/screenshot`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "x-display-name": capture.displayName,
        "x-captured-at": new Date().toISOString(),
        "x-viewport-width": String(capture.viewportWidth),
        "x-viewport-height": String(capture.viewportHeight),
        "x-device-pixel-ratio": String(window.devicePixelRatio || 1),
        "x-page-path": `${window.location.pathname}${window.location.search}`,
      },
      body: form,
    });
  } catch (error) {
    throw new DisplayScreenshotError(String(error), "upload", undefined, undefined, capture.image.size);
  }

  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const serverError = typeof payload?.error === "string" ? payload.error : undefined;
    throw new DisplayScreenshotError(
      `display_screenshot_upload_failed_${response.status}`,
      "upload",
      response.status,
      serverError,
      capture.image.size,
    );
  }
}

export function DisplayScreenshotReporter() {
  const stateRef = useRef<ScreenshotState>("idle");

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    let attemptIndex = 0;

    const setState = (state: ScreenshotState) => {
      stateRef.current = state;
    };

    const attemptInProgress = () => stateRef.current === "capturing" || stateRef.current === "uploading";

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delayMs: number) => {
      if (stopped || stateRef.current === "succeeded" || attemptInProgress() || timer !== null) return;
      setState(delayMs > 0 ? "retry-wait" : "idle");
      timer = window.setTimeout(() => {
        timer = null;
        void runAttempt();
      }, delayMs);
    };

    const runAttempt = async () => {
      if (stopped || stateRef.current === "succeeded" || attemptInProgress()) return;
      if (document.hidden || !navigator.onLine) {
        setState("retry-wait");
        return;
      }
      if (isAppVersionWatcherBusy()) {
        setState("retry-wait");
        schedule(1_000);
        return;
      }

      try {
        setState("capturing");
        const capture = await captureDisplay();
        if (stopped) return;
        setState("uploading");
        await uploadDisplayScreenshot(capture);
        if (stopped) return;
        setState("succeeded");
      } catch (error) {
        if (stopped) return;
        const detail = error instanceof DisplayScreenshotError ? error : null;
        console.warn("Unable to upload display screenshot", {
          stage: detail?.stage ?? "capture",
          status: detail?.status,
          serverError: detail?.serverError,
          blobSize: detail?.blobSize,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          message: error instanceof Error ? error.message : String(error),
        });
        const retryDelay = getScreenshotRetryDelay(attemptIndex);
        attemptIndex += 1;
        setState("retry-wait");
        if (retryDelay !== null && isRetryableScreenshotError(error)) {
          schedule(retryDelay);
        }
      }
    };

    const resume = () => {
      if (document.hidden || !navigator.onLine || stateRef.current === "succeeded") return;
      clearTimer();
      schedule(250);
    };

    schedule(CAPTURE_DELAY_MS);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      stopped = true;
      clearTimer();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, []);

  return null;
}
