import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWallpaper: vi.fn(),
  setWallpaper: vi.fn(),
  uploadWallpaper: vi.fn(),
  deleteWallpaper: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getWallpaper: mocks.getWallpaper,
  setWallpaper: mocks.setWallpaper,
  uploadWallpaper: mocks.uploadWallpaper,
  deleteWallpaper: mocks.deleteWallpaper,
}));

import { BUILTIN_WALLPAPERS, DEFAULT_WALLPAPER_ID, useWallpaperStore } from "./wallpaperStore";

function reset() {
  useWallpaperStore.setState({ status: "idle", current: null, custom: [] });
}

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("wallpaperStore load", () => {
  it("stores the daemon-reported selection and custom list", async () => {
    mocks.getWallpaper.mockResolvedValue({
      current: "abc",
      custom: [{ id: "abc", label: "Trip", addedAt: "2026-08-25T00:00:00Z" }],
    });
    await useWallpaperStore.getState().load();
    expect(useWallpaperStore.getState()).toMatchObject({
      status: "ready",
      current: "abc",
      custom: [{ id: "abc" }],
    });
  });

  it("marks error without touching current when the daemon is unreachable", async () => {
    mocks.getWallpaper.mockRejectedValue(new Error("down"));
    await useWallpaperStore.getState().load();
    expect(useWallpaperStore.getState().status).toBe("error");
    expect(useWallpaperStore.getState().current).toBeNull();
  });
});

describe("wallpaperStore select", () => {
  it("applies locally after the daemon accepts", async () => {
    mocks.setWallpaper.mockResolvedValue(undefined);
    const applied = await useWallpaperStore.getState().select("dusk");
    expect(applied).toBe(true);
    expect(mocks.setWallpaper).toHaveBeenCalledWith("dusk");
    expect(useWallpaperStore.getState().current).toBe("dusk");
  });

  it("keeps the old selection when the daemon rejects", async () => {
    useWallpaperStore.setState({ current: "aqua" });
    mocks.setWallpaper.mockRejectedValue(new Error("nope"));
    const applied = await useWallpaperStore.getState().select("dusk");
    expect(applied).toBe(false);
    expect(useWallpaperStore.getState().current).toBe("aqua");
  });
});

describe("wallpaperStore remove", () => {
  it("drops the record and falls back to Aqua when the active wallpaper is deleted", async () => {
    mocks.deleteWallpaper.mockResolvedValue(undefined);
    useWallpaperStore.setState({
      current: "abc",
      custom: [
        { id: "abc", label: "Trip", addedAt: "x" },
        { id: "def", label: "Other", addedAt: "y" },
      ],
    });
    await useWallpaperStore.getState().remove("abc");
    const state = useWallpaperStore.getState();
    expect(state.custom.map((w) => w.id)).toEqual(["def"]);
    expect(state.current).toBe(DEFAULT_WALLPAPER_ID);
  });

  it("keeps the selection when a non-active wallpaper is deleted", async () => {
    mocks.deleteWallpaper.mockResolvedValue(undefined);
    useWallpaperStore.setState({
      current: "def",
      custom: [
        { id: "abc", label: "Trip", addedAt: "x" },
        { id: "def", label: "Other", addedAt: "y" },
      ],
    });
    await useWallpaperStore.getState().remove("abc");
    expect(useWallpaperStore.getState().current).toBe("def");
  });
});

describe("wallpaperStore upload", () => {
  it("appends the created record to the custom list", async () => {
    const created = { id: "new", label: "Shot", addedAt: "z" };
    mocks.uploadWallpaper.mockResolvedValue(created);
    const blob = new Blob(["bytes"]);
    const result = await useWallpaperStore.getState().upload(blob, "Shot");
    expect(result).toEqual(created);
    expect(mocks.uploadWallpaper).toHaveBeenCalledWith(blob, "Shot");
    expect(useWallpaperStore.getState().custom).toContainEqual(created);
  });

  it("propagates daemon errors without mutating the list", async () => {
    mocks.uploadWallpaper.mockRejectedValue(new Error("bad format"));
    await expect(useWallpaperStore.getState().upload(new Blob([]), "x")).rejects.toThrow("bad format");
    expect(useWallpaperStore.getState().custom).toHaveLength(0);
  });

  it("ships built-ins with Aqua first", () => {
    expect(BUILTIN_WALLPAPERS[0]?.id).toBe(DEFAULT_WALLPAPER_ID);
    expect(BUILTIN_WALLPAPERS.length).toBeGreaterThan(1);
  });
});
