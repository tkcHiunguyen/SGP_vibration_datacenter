import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

export interface Colors {
  bg: string;
  surface: string;
  card: string;
  border: string;
  cardBorder: string;
  input: string;
  headerBg: string;
  primary: string;
  primaryDim: string;
  primaryGlow: string;
  primaryBg: string;
  textBright: string;
  textBase: string;
  textMuted: string;
  textDim: string;
  danger: string;
  dangerBg: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  navActive: string;
  scrollbar: string;
}

export function getColors(theme: Theme): Colors {
  if (theme === "dark") {
    /* ══════════════════════════════════════════
       DARK  ·  Midnight × Sapphire
       Nền đêm sâu, accent sapphire điện
    ══════════════════════════════════════════ */
    return {
      bg:          "#07090f",   // midnight near-black
      surface:     "#0b0f1c",   // deep navy surface
      card:        "#0f1628",   // dark sapphire card
      border:      "#192240",   // navy border
      cardBorder:  "#1e2c52",   // card outline
      input:       "#090d1a",   // input field
      headerBg:    "#080b17",   // darkest header
      primary:     "#60a5fa",   // blue-400  ★
      primaryDim:  "#3b82f6",   // blue-500
      primaryGlow: "#60a5fa1e", // ambient sapphire glow
      primaryBg:   "#60a5fa0e", // subtle tint
      textBright:  "#eef4ff",   // ① ice white — tiêu đề, tên thiết bị
      textBase:    "#94b8e8",   // ② xanh-xám sáng — nhãn, giá trị đọc được
      textMuted:   "#5578a8",   // ③ xanh mờ vừa — ID, zone, phụ chú
      textDim:     "#283c5a",   // ④ rất mờ — divider label, watermark
      danger:      "#f87171",   // rose-400
      dangerBg:    "#f8717114",
      success:     "#34d399",   // emerald-400
      successBg:   "#34d39912",
      warning:     "#fbbf24",   // amber-400
      warningBg:   "#fbbf2414",
      navActive:   "#0f1628",
      scrollbar:   "#192240",
    };
  }

  /* ══════════════════════════════════════════
     LIGHT  ·  Ice White × Deep Sapphire
     Nền trắng băng, accent xanh sapphire đậm
  ══════════════════════════════════════════ */
  return {
    bg:          "#eef3fd",   // pale blue-white
    surface:     "#dde8fa",   // slightly deeper
    card:        "#ffffff",
    border:      "#bdd0f0",   // soft sapphire border
    cardBorder:  "#aac0eb",
    input:       "#f6f9ff",
    headerBg:    "#ffffff",
    primary:     "#1d4ed8",   // blue-700  ★
    primaryDim:  "#1e40af",   // blue-800
    primaryGlow: "#1d4ed814",
    primaryBg:   "#1d4ed80c",
    textBright:  "#060c20",   // ① đen midnight — tiêu đề
    textBase:    "#1a3565",   // ② navy đậm — nội dung chính
    textMuted:   "#3d5e99",   // ③ xanh trung — nhãn phụ
    textDim:     "#7a9ccb",   // ④ xanh nhạt — chú thích
    danger:      "#dc2626",
    dangerBg:    "#dc262610",
    success:     "#059669",
    successBg:   "#05966910",
    warning:     "#d97706",
    warningBg:   "#d9770610",
    navActive:   "#d4e3f8",
    scrollbar:   "#aac0eb",
  };
}

const THEME_STORAGE_KEY = "sgp_ui_theme";

function readStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "dark";
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  C: Colors;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
  C: getColors("dark"),
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const C = getColors(theme);
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme: () => setTheme(t => t === "dark" ? "light" : "dark"), C }}>
      {children}
    </ThemeContext.Provider>
  );
}
