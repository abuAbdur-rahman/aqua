import { describe, expect, it } from "vitest";
import {
  ZONE_MARGIN,
  clampFreePosition,
  placeInZone,
  placementForNew,
  restackWidgets,
  widgetSize,
  zoneOf,
} from "./widgetLayout";

const VW = 1600;
const VH = 900;

describe("widget sizing", () => {
  it("rhymes widths across widgets, varies heights per type", () => {
    expect(widgetSize("small")).toEqual({ w: 220, h: 220 });
    expect(widgetSize("medium")).toEqual({ w: 460, h: 220 });
    // Calendar and weather are taller; clock stays compact and narrow.
    expect(widgetSize("small", "calendar")).toEqual({ w: 220, h: 252 });
    expect(widgetSize("medium", "calendar")).toEqual({ w: 460, h: 304 });
    expect(widgetSize("small", "weather")).toEqual({ w: 220, h: 264 });
    expect(widgetSize("small", "clock")).toEqual({ w: 220, h: 150 });
    expect(widgetSize("medium", "clock")).toEqual({ w: 300, h: 160 });
  });
});

describe("zones", () => {
  it("classifies a widget by its nearest corner", () => {
    expect(zoneOf({ x: 56, y: 56 }, VW, VH)).toBe("top-left");
    expect(zoneOf({ x: 1400, y: 56 }, VW, VH)).toBe("top-right");
    expect(zoneOf({ x: 56, y: 700 }, VW, VH)).toBe("bottom-left");
    expect(zoneOf({ x: 1400, y: 700 }, VW, VH)).toBe("bottom-right");
  });

  it("anchors each zone near its screen corner", () => {
    expect(placeInZone("top-left", [], VW, VH, "small")).toEqual({ x: ZONE_MARGIN.x, y: ZONE_MARGIN.top });
    const tr = placeInZone("top-right", [], VW, VH, "small");
    expect(tr.x).toBe(VW - ZONE_MARGIN.x - 220);
    const bl = placeInZone("bottom-left", [], VW, VH, "small");
    expect(bl.y).toBe(VH - ZONE_MARGIN.bottom - 220);
  });

  it("stacks widgets in a zone with a 20px gap, honoring each card's height", () => {
    const first = placeInZone("top-left", [], VW, VH, "small", "clock");
    const second = placeInZone("top-left", [{ x: first.x, y: first.y, size: "small", type: "clock" }], VW, VH, "small", "calendar");
    expect(first).toEqual({ x: 56, y: ZONE_MARGIN.top });
    expect(second.y - first.y).toBe(150 + ZONE_MARGIN.gap);
  });

  it("clusters new widgets into the last widget's zone", () => {
    // First widget anchors top-right (macOS-style), not top-left.
    const clock = placementForNew([], "small", "clock", VW, VH);
    expect(clock).toEqual({ x: VW - ZONE_MARGIN.x - 220, y: ZONE_MARGIN.top });
    // Calendar joins the clock's zone (stacked below) instead of jumping to a far corner.
    const calendar = placementForNew([{ x: clock.x, y: clock.y, size: "small", type: "clock" }], "small", "calendar", VW, VH);
    expect(calendar).toEqual({ x: VW - ZONE_MARGIN.x - 220, y: ZONE_MARGIN.top + 150 + ZONE_MARGIN.gap });
  });

  it("restacks a zone to close the gap left by a removed widget", () => {
    const a = { id: "a", type: "clock" as const, x: 56, y: 56, size: "small" as const };
    const b = { id: "b", type: "calendar" as const, x: 56, y: 226, size: "small" as const };
    const c = { id: "c", type: "weather" as const, x: 1324, y: 56, size: "small" as const };
    const packed = restackWidgets([a, b, c].filter((w) => w.id !== "a"), VW, VH);
    expect(packed.find((w) => w.id === "b")).toMatchObject({ x: 56, y: 56 });
    expect(packed.find((w) => w.id === "c")).toMatchObject({ x: 1324, y: 56 });
  });
});

describe("free positioning", () => {
  it("clamps a dropped widget inside the usable desktop", () => {
    expect(clampFreePosition(-50, -50, "small", "clock", VW, VH)).toEqual({ x: 0, y: 24 });
    expect(clampFreePosition(99999, 99999, "small", "clock", VW, VH)).toEqual({
      x: VW - 220,
      y: VH - 72 - 150,
    });
  });

  it("keeps resized medium widgets inside the desktop", () => {
    const clamped = clampFreePosition(VW - 60, 200, "medium", "calendar", VW, VH);
    expect(clamped.x).toBe(VW - 460);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
  });
});
