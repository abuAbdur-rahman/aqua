import { create } from "zustand";
import {
  deleteWallpaper,
  getWallpaper,
  setWallpaper,
  uploadWallpaper,
  type CustomWallpaper,
} from "../lib/api";

export interface BuiltinWallpaper {
  id: string;
  label: string;
  background: string;
}

// Frontend-owned static wallpapers. "Aqua" is the default gradient from DESIGN.md
// and must stay first — it is the fallback whenever a custom wallpaper disappears.
export const BUILTIN_WALLPAPERS: BuiltinWallpaper[] = [
  {
    id: "aqua",
    label: "Aqua",
    background:
      "radial-gradient(1200px 600px at 75% -10%, rgba(34,211,238,0.08), transparent 60%), linear-gradient(180deg, #101820 0%, #0d1a1e 85%, #0a1418 100%)",
  },
  {
    id: "dusk",
    label: "Dusk",
    background:
      "radial-gradient(1000px 500px at 25% -10%, rgba(129,140,248,0.10), transparent 60%), linear-gradient(180deg, #14141f 0%, #12121c 85%, #0e0e16 100%)",
  },
  {
    id: "slate",
    label: "Slate",
    background:
      "radial-gradient(1100px 550px at 80% -5%, rgba(148,163,184,0.09), transparent 60%), linear-gradient(180deg, #15181c 0%, #111418 85%, #0d1013 100%)",
  },
];

export const DEFAULT_WALLPAPER_ID = "aqua";

type Status = "idle" | "loading" | "ready" | "error";

interface WallpaperStoreState {
  status: Status;
  /** Daemon-reported selection; null until the first GET resolves so no tile shows a stale badge. */
  current: string | null;
  custom: CustomWallpaper[];
  load: () => Promise<void>;
  /** Applies immediately; returns false when the daemon rejected the selection. */
  select: (id: string) => Promise<boolean>;
  /** Resolves with the created record; rejects with the daemon's error message. */
  upload: (file: Blob, label: string) => Promise<CustomWallpaper>;
  remove: (id: string) => Promise<void>;
}

export const useWallpaperStore = create<WallpaperStoreState>((set, get) => ({
  status: "idle",
  current: null,
  custom: [],

  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      const state = await getWallpaper();
      set({ status: "ready", current: state.current, custom: state.custom });
    } catch {
      set({ status: "error" });
    }
  },

  select: async (id) => {
    try {
      await setWallpaper(id);
      set({ current: id });
      return true;
    } catch {
      return false;
    }
  },

  upload: async (file, label) => {    const wallpaper = await uploadWallpaper(file, label);
    set((s) => ({ custom: [...s.custom, wallpaper] }));
    return wallpaper;
  },

  remove: async (id) => {
    await deleteWallpaper(id);
    set((s) => ({
      // Daemon falls back to the built-in default when the active custom
      // wallpaper is deleted; mirror that immediately so the desktop never
      // points at an asset that no longer exists.
      current: s.current === id ? DEFAULT_WALLPAPER_ID : s.current,
      custom: s.custom.filter((w) => w.id !== id),
    }));
  },
}));
