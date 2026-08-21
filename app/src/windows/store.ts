import { create } from "zustand";
import { appManifest } from "./manifest";

export interface WindowRecord {
  id: string;
  appId: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  focused: boolean;
  prevBounds: { x: number; y: number; w: number; h: number } | null;
  maximized: boolean;
}

interface WindowState {
  windows: WindowRecord[];
  nextZ: number;
  focusedId: string | null;
  openApp: (appId: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  updateBounds: (id: string, b: Partial<Pick<WindowRecord, "x" | "y" | "w" | "h">>) => void;
  toggleMaximize: (id: string, container: { w: number; h: number }) => void;
  bringToFront: (id: string) => void;
}

let idSeq = 1;
function nextId() {
  return `win_${idSeq++}`;
}

export const useWindowStore = create<WindowState>((set, get) => ({
  windows: [],
  nextZ: 10,
  focusedId: null,

  openApp: (appId) => {
    const manifest = appManifest[appId];
    if (!manifest) return;
    const { windows, nextZ } = get();
    // If already open and minimized, restore instead of duplicating (single instance per app in Phase 1)
    const existing = windows.find((w) => w.appId === appId);
    if (existing) {
      if (existing.minimized) {
        set({
          windows: windows.map((w) =>
            w.id === existing.id ? { ...w, minimized: false, focused: true, z: nextZ } : { ...w, focused: false },
          ),
          nextZ: nextZ + 1,
          focusedId: existing.id,
        });
      } else {
        get().focus(existing.id);
      }
      return;
    }

    const count = windows.length;
    const offset = 28 * (count % 6);
    const w = manifest.defaultSize.w;
    const h = manifest.defaultSize.h;

    const win: WindowRecord = {
      id: nextId(),
      appId,
      title: manifest.name,
      x: 80 + offset,
      y: 40 + offset,
      w,
      h,
      z: nextZ,
      minimized: false,
      focused: true,
      prevBounds: null,
      maximized: false,
    };

    set({
      windows: [...windows.map((w) => ({ ...w, focused: false })), win],
      nextZ: nextZ + 1,
      focusedId: win.id,
    });
  },

  close: (id) =>
    set((s) => {
      const remaining = s.windows.filter((w) => w.id !== id);
      const nextFocus = remaining.length ? remaining.reduce((a, b) => (a.z > b.z ? a : b)).id : null;
      return {
        windows: remaining.map((w) => ({ ...w, focused: w.id === nextFocus })),
        focusedId: nextFocus,
      };
    }),

  focus: (id) =>
    set((s) => {
      const z = s.nextZ;
      return {
        windows: s.windows.map((w) => (w.id === id ? { ...w, focused: true, minimized: false, z } : { ...w, focused: false })),
        nextZ: z + 1,
        focusedId: id,
      };
    }),

  bringToFront: (id) =>
    set((s) => {
      const win = s.windows.find((w) => w.id === id);
      if (!win || win.z === s.nextZ - 1) return {};
      return {
        windows: s.windows.map((w) => (w.id === id ? { ...w, z: s.nextZ } : w)),
        nextZ: s.nextZ + 1,
      };
    }),

  minimize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true, focused: false } : w)),
      focusedId: s.focusedId === id ? null : s.focusedId,
    })),

  restore: (id) =>
    set((s) => {
      const z = s.nextZ;
      return {
        windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: false, focused: true, z } : { ...w, focused: false })),
        nextZ: z + 1,
        focusedId: id,
      };
    }),

  updateBounds: (id, b) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, ...b } : w)),
    })),

  toggleMaximize: (id, container) =>
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const prev = w.prevBounds ?? { x: 80, y: 40, w: w.w, h: w.h };
          return { ...w, ...prev, maximized: false, prevBounds: null };
        }
        return {
          ...w,
          prevBounds: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: 8,
          y: 8,
          w: container.w - 16,
          h: container.h - 16,
          maximized: true,
        };
      }),
    })),
}));
