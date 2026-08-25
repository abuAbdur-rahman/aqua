import { create } from "zustand";

const REDUCE_MOTION_KEY = "aqua.prefs.reduceMotion";
const DOCK_SIZE_KEY = "aqua.prefs.dockSize";

export const DOCK_SIZE_MIN = 40;
export const DOCK_SIZE_MAX = 56;
export const DOCK_SIZE_DEFAULT = 48;

/** Magnify-on-hover always adds this much over the base size (DESIGN.md 48→64 ratio). */
export const DOCK_MAGNIFY_DELTA = 16;

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

interface PrefsState {
  reduceMotion: boolean;
  dockSize: number;
  setReduceMotion: (value: boolean) => void;
  setDockSize: (value: number) => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  reduceMotion: readReduceMotion(),
  dockSize: readDockSize(),
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
}));

/** True when either the in-app toggle or the OS-level media query asks for less motion. */
export function systemReducedMotion(): boolean {
  return (
    usePrefsStore.getState().reduceMotion ||
    (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}
