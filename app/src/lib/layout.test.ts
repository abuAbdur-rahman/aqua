import { describe, expect, it } from "vitest";
import { serializeLayout, deserializeLayout, type LayoutState } from "./layout";
import type { WindowRecord, SpaceRecord } from "../windows/store";

const spaces: SpaceRecord[] = [
  { id: 1, name: "Desktop 1" },
  { id: 2, name: "Desktop 2" },
];

const windows: WindowRecord[] = [
  {
    id: "win_1",
    appId: "finder",
    title: "Finder",
    x: 100,
    y: 50,
    w: 720,
    h: 480,
    z: 10,
    minimized: false,
    focused: true,
    prevBounds: null,
    maximized: false,
    spaceId: 1,
  },
  {
    id: "win_2",
    appId: "terminal",
    title: "Terminal",
    x: 200,
    y: 120,
    w: 680,
    h: 420,
    z: 11,
    minimized: true,
    focused: false,
    prevBounds: null,
    maximized: false,
    spaceId: 2,
  },
];

describe("layout serialization", () => {
  it("round-trips windows and spaces through LayoutState", () => {
    const layout = serializeLayout(windows, spaces);
    expect(layout.windows).toHaveLength(2);
    expect(layout.windows[0]).toMatchObject({ id: "win_1", app: "finder", spaceId: 1, zIndex: 10, appState: { maximized: false, prevBounds: null } });
    expect(layout.spaces[1]).toMatchObject({ id: 2, name: "Desktop 2", orderIndex: 1 });

    const data = deserializeLayout(layout, { w: 1920, h: 1080 });
    expect(data.windows[0]).toMatchObject({ id: "win_1", appId: "finder", z: 10, spaceId: 1 });
    expect(data.nextZ).toBe(12);
    expect(data.idSeq).toBe(3);
    expect(data.activeSpaceId).toBe(1);
  });

  it("clamps out-of-bounds windows into the visible area", () => {
    const offscreen: LayoutState = {
      windows: [
        { id: "win_5", app: "finder", spaceId: 1, x: -500, y: -500, w: 300, h: 200, minimized: false, zIndex: 5, appState: null },
        { id: "win_6", app: "finder", spaceId: 1, x: 9000, y: 9000, w: 300, h: 200, minimized: false, zIndex: 6, appState: null },
      ],
      spaces: [{ id: 1, name: "Desktop 1", orderIndex: 0 }],
    };
    const data = deserializeLayout(offscreen, { w: 1000, h: 600 });
    expect(data.windows[0].x).toBe(0);
    expect(data.windows[0].y).toBe(24);
    expect(data.windows[1].x).toBe(700);
    expect(data.windows[1].y).toBe(600 - 72 - 200);
  });
});
