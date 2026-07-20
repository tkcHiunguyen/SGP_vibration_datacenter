import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const WALLBOARD_STORAGE_KEY = "sgp:wallboard-mode:v1";
const WALLBOARD_MIN_VIEWPORT_WIDTH = 2200;
const WALLBOARD_MIN_VIEWPORT_HEIGHT = 1200;

type DisplayModeContextValue = {
  wallboard: boolean;
  autoDetected: boolean;
  manualOverride: boolean | null;
  toggleWallboard: () => void;
};

const DisplayModeContext = createContext<DisplayModeContextValue | null>(null);

function readWallboardOverride(): boolean | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(WALLBOARD_STORAGE_KEY);
    return stored === "true" ? true : stored === "false" ? false : null;
  } catch {
    return null;
  }
}

function detectWallboardDisplay(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const physicalWidth = Math.max(window.screen.width, window.screen.availWidth) * pixelRatio;
  const physicalHeight = Math.max(window.screen.height, window.screen.availHeight) * pixelRatio;
  const largeCssViewport = window.innerWidth >= 2400 && window.innerHeight >= WALLBOARD_MIN_VIEWPORT_HEIGHT;
  const scaled4kDisplay = physicalWidth >= 3600
    && physicalHeight >= 2000
    && window.innerWidth >= WALLBOARD_MIN_VIEWPORT_WIDTH
    && window.innerHeight >= WALLBOARD_MIN_VIEWPORT_HEIGHT;

  return largeCssViewport || scaled4kDisplay;
}

export function DisplayModeProvider({ children }: { children: React.ReactNode }) {
  const [manualOverride, setManualOverride] = useState<boolean | null>(readWallboardOverride);
  const [autoDetected, setAutoDetected] = useState(detectWallboardDisplay);
  const [desktopViewport, setDesktopViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1200,
  );

  useEffect(() => {
    const updateDisplayDetection = () => {
      setAutoDetected(detectWallboardDisplay());
      setDesktopViewport(window.innerWidth >= 1200);
    };

    updateDisplayDetection();
    window.addEventListener("resize", updateDisplayDetection);
    return () => window.removeEventListener("resize", updateDisplayDetection);
  }, []);

  const wallboard = desktopViewport && (manualOverride ?? autoDetected);

  useEffect(() => {
    document.documentElement.dataset.displayMode = wallboard ? "wallboard" : "standard";
    return () => {
      delete document.documentElement.dataset.displayMode;
    };
  }, [wallboard]);

  useEffect(() => {
    try {
      if (manualOverride === null) {
        window.localStorage.removeItem(WALLBOARD_STORAGE_KEY);
      } else {
        window.localStorage.setItem(WALLBOARD_STORAGE_KEY, String(manualOverride));
      }
    } catch {
      // Display mode still works in-memory when storage is unavailable.
    }
  }, [manualOverride]);

  const toggleWallboard = useCallback(() => {
    setManualOverride((current) => !(current ?? autoDetected));
  }, [autoDetected]);

  const value = useMemo<DisplayModeContextValue>(
    () => ({ wallboard, autoDetected, manualOverride, toggleWallboard }),
    [autoDetected, manualOverride, toggleWallboard, wallboard],
  );

  return <DisplayModeContext.Provider value={value}>{children}</DisplayModeContext.Provider>;
}

export function useDisplayMode(): DisplayModeContextValue {
  const context = useContext(DisplayModeContext);
  if (!context) {
    throw new Error("useDisplayMode must be used within DisplayModeProvider");
  }
  return context;
}
