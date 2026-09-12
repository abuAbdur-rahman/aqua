import { create } from "zustand";

const REDUCE_MOTION_KEY = "aqua.prefs.reduceMotion";
const DOCK_SIZE_KEY = "aqua.prefs.dockSize";
const UI_SCALE_KEY = "aqua.prefs.uiScale";
const ACCENT_KEY = "aqua.prefs.accent";

export const DOCK_SIZE_MIN = 40;
export const DOCK_SIZE_MAX = 56;
export const DOCK_SIZE_DEFAULT = 48;

/** Magnify-on-hover always adds this much over the base size (DESIGN.md 48→64 ratio). */
export const DOCK_MAGNIFY_DELTA = 16;

export const UI_SCALE_MIN = 85;
export const UI_SCALE_MAX = 115;
export const UI_SCALE_DEFAULT = 100;

/** Dark-mode-friendly accent presets (DESIGN.md default is Cyan). */
export const ACCENT_PRESETS = [
  { id: "cyan", label: "Cyan", hex: "#22d3ee" },
  { id: "mint", label: "Mint", hex: "#4ade80" },
  { id: "blue", label: "Blue", hex: "#60a5fa" },
  { id: "violet", label: "Violet", hex: "#a78bfa" },
  { id: "rose", label: "Rose", hex: "#fb7185" },
  { id: "amber", label: "Amber", hex: "#fbbf24" },
  { id: "orange", label: "Orange", hex: "#fb923c" },
  { id: "pink", label: "Pink", hex: "#f472b6" },
] as const;

export const ACCENT_DEFAULT = ACCENT_PRESETS[0];

export interface AccentChoice {
  id: string;
  hex: string;
}

function clampHex(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : ACCENT_DEFAULT.hex;
}

function readReduceMotion(): boolean {
  try {
    return localStorage.getItem(REDUCE_MOTION_KEY) === "true";
  } catch {
    return false;
  }
}

function readDockSize(): number {
  try {
    const raw = Number(localStorage.getItem(DOCK_SIZE_KEY));
    if (Number.isFinite(raw)) return Math.min(DOCK_SIZE_MAX, Math.max(DOCK_SIZE_MIN, raw));
  } catch {
    // storage unavailable — fall through to default
  }
  return DOCK_SIZE_DEFAULT;
}

function readUiScale(): number {
  try {
    const raw = Number(localStorage.getItem(UI_SCALE_KEY));
    if (Number.isFinite(raw)) return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
  } catch {
    // storage unavailable — fall through to default
  }
  return UI_SCALE_DEFAULT;
}

function readAccent(): AccentChoice {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ACCENT_KEY) ?? "null");
    if (
      typeof raw === "object" && raw !== null &&
      typeof (raw as AccentChoice).id === "string" &&
      typeof (raw as AccentChoice).hex === "string"
    ) {
      return { id: (raw as AccentChoice).id, hex: clampHex((raw as AccentChoice).hex) };
    }
  } catch {
    // storage unavailable — fall through to default
  }
  return { id: ACCENT_DEFAULT.id, hex: ACCENT_DEFAULT.hex };
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** accent-strong: lighten toward white so it reads as the brighter shade. */
function lighten(hex: string, amount = 0.35): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Push the accent choice into the CSS custom properties every component reads. */
export function applyAccent(accent: AccentChoice): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", accent.hex);
  root.style.setProperty("--accent-strong", lighten(accent.hex));
  root.style.setProperty("--accent-bg", rgba(accent.hex, 0.14));
  root.style.setProperty("--accent-ring", rgba(accent.hex, 0.45));
  root.style.setProperty("--color-accent", accent.hex);
  root.style.setProperty("--color-accent-strong", lighten(accent.hex));
  root.style.setProperty("--color-accent-bg", rgba(accent.hex, 0.14));
  root.style.setProperty("--color-accent-ring", rgba(accent.hex, 0.45));
}

export function applyUiScale(scale: number): void {
  // Tailwind sizes are rem-based; scaling the root font-size scales the UI.
  document.documentElement.style.fontSize = `${(16 * scale) / 100}px`;
}

interface PrefsState {
  reduceMotion: boolean;
  dockSize: number;
  uiScale: number;
  accent: AccentChoice;
  setReduceMotion: (value: boolean) => void;
  setDockSize: (value: number) => void;
  setUiScale: (value: number) => void;
  setAccent: (value: AccentChoice) => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  reduceMotion: readReduceMotion(),
  dockSize: readDockSize(),
  uiScale: readUiScale(),
  accent: readAccent(),
  setReduceMotion: (value) => {
    try {
      localStorage.setItem(REDUCE_MOTION_KEY, String(value));
    } catch {
      // preference still applies for this session
    }
    set({ reduceMotion: value });
  },
  setDockSize: (value) => {
    const clamped = Math.min(DOCK_SIZE_MAX, Math.max(DOCK_SIZE_MIN, value));
    try {
      localStorage.setItem(DOCK_SIZE_KEY, String(clamped));
    } catch {
      // preference still applies for this session
    }
    set({ dockSize: clamped });
  },
  setUiScale: (value) => {
    const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
    try {
      localStorage.setItem(UI_SCALE_KEY, String(clamped));
    } catch {
      // preference still applies for this session
    }
    applyUiScale(clamped);
    set({ uiScale: clamped });
  },
  setAccent: (value) => {
    const normalized = { id: value.id, hex: clampHex(value.hex) };
    try {
      localStorage.setItem(ACCENT_KEY, JSON.stringify(normalized));
    } catch {
      // preference still applies for this session
    }
    applyAccent(normalized);
    set({ accent: normalized });
  },
}));

// Apply persisted prefs on boot, before first paint of dependent components.
applyUiScale(usePrefsStore.getState().uiScale);
applyAccent(usePrefsStore.getState().accent);

/** True when either the in-app toggle or the OS-level media query asks for less motion. */
export function systemReducedMotion(): boolean {
  return (
    usePrefsStore.getState().reduceMotion ||
    (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}
