import type { WindowRecord, SpaceRecord } from "../windows/store";
import { appManifest } from "../windows/manifest";
import { DAEMON_BASE } from "./api";

export interface LayoutWindow {
  id: string;
  app: string;
  spaceId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  zIndex: number;
  appState: unknown;
}

export interface LayoutSpace {
  id: number;
  name: string;
  orderIndex: number;
}

export interface LayoutState {
  windows: LayoutWindow[];
  spaces: LayoutSpace[];
}

// Visible desktop area inside the frameless shell: below the 24px MenuBar,
// above the 72px Dock zone. Restored windows are clamped into this region.
const TOP_RESERVED = 24;
const BOTTOM_RESERVED = 72;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function serializeLayout(windows: WindowRecord[], spaces: SpaceRecord[]): LayoutState {
  return {
    windows: windows.map((w) => ({
      id: w.id,
      app: w.appId,
      spaceId: w.spaceId,
      x: Math.round(w.x),
      y: Math.round(w.y),
      w: Math.round(w.w),
      h: Math.round(w.h),
      minimized: w.minimized,
      zIndex: w.z,
      appState: { maximized: w.maximized, prevBounds: w.prevBounds },
    })),
    spaces: spaces.map((sp, i) => ({ id: sp.id, name: sp.name, orderIndex: i })),
  };
}

export interface HydrateData {
  windows: WindowRecord[];
  spaces: SpaceRecord[];
  activeSpaceId: number;
  nextZ: number;
  idSeq: number;
}

export function deserializeLayout(layout: LayoutState, viewport: { w: number; h: number }): HydrateData {
  const spaces: SpaceRecord[] = (layout.spaces ?? []).map((s) => ({ id: s.id, name: s.name }));
  const activeSpaceId = spaces.length ? spaces[0].id : 1;

  const windows: WindowRecord[] = (layout.windows ?? []).map((lw) => {
    const appState =
      typeof lw.appState === "object" && lw.appState !== null
        ? (lw.appState as { maximized?: boolean; prevBounds?: WindowRecord["prevBounds"] })
        : {};
    const w = Math.max(120, Math.round(lw.w));
    const h = Math.max(80, Math.round(lw.h));
    const maxX = Math.max(0, viewport.w - w);
    const maxY = Math.max(TOP_RESERVED, viewport.h - BOTTOM_RESERVED - h);
    return {
      id: lw.id,
      appId: lw.app,
      title: appManifest[lw.app]?.name ?? lw.app,
      x: clamp(Math.round(lw.x), 0, maxX),
      y: clamp(Math.round(lw.y), TOP_RESERVED, maxY),
      w,
      h,
      z: lw.zIndex,
      minimized: lw.minimized,
      focused: false,
      prevBounds: appState.prevBounds ?? null,
      maximized: appState.maximized ?? false,
      spaceId: lw.spaceId,
    };
  });

  const nextZ = windows.reduce((m, ww) => Math.max(m, ww.z), 0) + 1;
  const idSeq =
    windows.reduce((m, ww) => {
      const n = Number(ww.id.replace(/^win_/, ""));
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0) + 1;

  return { windows, spaces, activeSpaceId, nextZ, idSeq };
}

export async function loadLayout(): Promise<LayoutState | null> {
  try {
    const res = await fetch(`${DAEMON_BASE}/api/state/layout`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LayoutState;
  } catch {
    return null;
  }
}

export async function saveLayout(layout: LayoutState): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_BASE}/api/state/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(layout),
    });
    return res.ok;
  } catch {
    return false;
  }
}
