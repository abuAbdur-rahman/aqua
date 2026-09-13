import { create } from "zustand";

export type ZoomApp = "finder" | "terminal" | "editor" | "gallery" | "reader";

const MIN = 0.7;
const MAX = 1.6;
const STEP = 0.1;

interface ZoomState {
  scales: Record<ZoomApp, number>;
  zoomIn: (app: ZoomApp) => void;
  zoomOut: (app: ZoomApp) => void;
  reset: (app: ZoomApp) => void;
  scaleFor: (app: ZoomApp) => number;
}

function clamp(v: number): number {
  return Math.min(MAX, Math.max(MIN, Math.round(v * 10) / 10));
}

export const useZoomStore = create<ZoomState>((set, get) => ({
  scales: { finder: 1, terminal: 1, editor: 1, gallery: 1, reader: 1 },
  zoomIn: (app) => set((s) => ({ scales: { ...s.scales, [app]: clamp(s.scales[app] + STEP) } })),
  zoomOut: (app) => set((s) => ({ scales: { ...s.scales, [app]: clamp(s.scales[app] - STEP) } })),
  reset: (app) => set((s) => ({ scales: { ...s.scales, [app]: 1 } })),
  scaleFor: (app) => get().scales[app] ?? 1,
}));

export function zoomAppForWindow(appId: string): ZoomApp | null {
  if (appId === "finder" || appId === "terminal" || appId === "editor" || appId === "gallery" || appId === "reader") {
    return appId;
  }
  return null;
}
