import { create } from "zustand";
import { appManifest } from "./manifest";

export interface SpaceRecord {
  id: number;
  name: string;
}

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
  spaceId: number;
}

interface WindowState {
  windows: WindowRecord[];
  spaces: SpaceRecord[];
  activeSpaceId: number;
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
  switchSpace: (id: number) => void;
  cycleSpace: (dir: 1 | -1) => void;
  addSpace: () => void;
  removeSpace: (id: number) => void;
  moveWindowToSpace: (winId: string, spaceId: number) => void;
  editorPathRequest: string | null;
  finderPathRequest: string | null;
  terminalPathRequest: string | null;
  openEditor: (path: string) => void;
  openFinder: (path: string) => void;
  openTerminal: (path: string) => void;
  clearEditorPathRequest: () => void;
  clearFinderPathRequest: () => void;
  clearTerminalPathRequest: () => void;
}

let idSeq = 1;
function nextId() {
  return `win_${idSeq++}`;
}

export const useWindowStore = create<WindowState>((set, get) => ({
  windows: [],
  spaces: [{ id: 1, name: "Desktop 1" }],
  activeSpaceId: 1,
  nextZ: 10,
  focusedId: null,
  editorPathRequest: null,
  finderPathRequest: null,
  terminalPathRequest: null,

  openApp: (appId) => {
    const manifest = appManifest[appId];
    if (!manifest) return;
    const { windows, nextZ, activeSpaceId } = get();
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
      spaceId: activeSpaceId,
    };

    set({
      windows: [...windows.map((w) => ({ ...w, focused: false })), win],
      nextZ: nextZ + 1,
      focusedId: win.id,
    });
  },

  openEditor: (path) => {
    set({ editorPathRequest: path });
    get().openApp("editor");
  },

  openFinder: (path) => {
    set({ finderPathRequest: path });
    get().openApp("finder");
  },

  openTerminal: (path) => {
    set({ terminalPathRequest: path });
    get().openApp("terminal");
  },

  clearEditorPathRequest: () => set({ editorPathRequest: null }),
  clearFinderPathRequest: () => set({ finderPathRequest: null }),
  clearTerminalPathRequest: () => set({ terminalPathRequest: null }),

  close: (id) =>
    set((s) => {
      const remaining = s.windows.filter((w) => w.id !== id);
      const visible = remaining.filter((w) => w.spaceId === s.activeSpaceId);
      const pool = visible.length ? visible : remaining;
      const nextFocus = pool.length ? pool.reduce((a, b) => (a.z > b.z ? a : b)).id : null;
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

  switchSpace: (id) =>
    set((s) => {
      if (!s.spaces.some((sp) => sp.id === id) || s.activeSpaceId === id) return {};
      const visible = s.windows.filter((w) => w.spaceId === id && !w.minimized);
      const top = visible.length ? visible.reduce((a, b) => (a.z > b.z ? a : b)) : null;
      return {
        activeSpaceId: id,
        windows: s.windows.map((w) => ({ ...w, focused: top != null && w.id === top.id })),
        focusedId: top?.id ?? null,
      };
    }),

  cycleSpace: (dir) => {
    const { spaces, activeSpaceId } = get();
    const idx = spaces.findIndex((sp) => sp.id === activeSpaceId);
    const next = spaces[(idx + dir + spaces.length) % spaces.length];
    get().switchSpace(next.id);
  },

  addSpace: () =>
    set((s) => {
      const id = Math.max(0, ...s.spaces.map((sp) => sp.id)) + 1;
      return { spaces: [...s.spaces, { id, name: `Desktop ${s.spaces.length + 1}` }] };
    }),

  removeSpace: (id) =>
    set((s) => {
      // macOS behavior: never remove the last space; windows shift to the next
      // space to the right, or the previous one when removing the rightmost.
      if (s.spaces.length <= 1) return {};
      const idx = s.spaces.findIndex((sp) => sp.id === id);
      if (idx === -1) return {};
      const target = s.spaces[idx + 1] ?? s.spaces[idx - 1];
      const wasActive = s.activeSpaceId === id;
      const spaces = s.spaces.filter((sp) => sp.id !== id);
      const windows = s.windows.map((w) => (w.spaceId === id ? { ...w, spaceId: target.id } : w));
      if (!wasActive) return { spaces, windows };
      // Follow macOS: deleting the active space lands you on the destination.
      const visible = windows.filter((w) => w.spaceId === target.id && !w.minimized);
      const top = visible.length ? visible.reduce((a, b) => (a.z > b.z ? a : b)) : null;
      return {
        spaces,
        windows: windows.map((w) => ({ ...w, focused: top != null && w.id === top.id })),
        activeSpaceId: target.id,
        focusedId: top?.id ?? null,
      };
    }),

  moveWindowToSpace: (winId, spaceId) =>
    set((s) => {
      const win = s.windows.find((w) => w.id === winId);
      if (!win || win.spaceId === spaceId || !s.spaces.some((sp) => sp.id === spaceId)) return {};
      const movingToActive = spaceId === s.activeSpaceId;
      const z = s.nextZ;
      return {
        windows: s.windows.map((w) =>
          w.id === winId
            ? { ...w, spaceId, z, focused: movingToActive, minimized: false }
            : movingToActive
              ? { ...w, focused: false }
              : w,
        ),
        nextZ: z + 1,
        focusedId: movingToActive ? winId : s.focusedId === winId ? null : s.focusedId,
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
