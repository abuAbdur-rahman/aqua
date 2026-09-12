import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetStore } from "./widgetStore";
import { ZONE_MARGIN } from "./widgetLayout";

const VW = 1024; // jsdom default viewport width
const VH = 768; // jsdom default viewport height

beforeEach(() => {
  localStorage.clear();
  useWidgetStore.setState({ widgets: [], editMode: false, projectsNotice: null });
});

describe("widget store layout", () => {
  it("places the first widget top-right, stacked with the next", () => {
    useWidgetStore.getState().addWidget("clock", "small");
    useWidgetStore.getState().addWidget("calendar", "small");
    const [clock, calendar] = useWidgetStore.getState().widgets;
    expect(clock).toMatchObject({ x: VW - ZONE_MARGIN.x - 220, y: ZONE_MARGIN.top });
    expect(calendar).toMatchObject({ x: VW - ZONE_MARGIN.x - 220, y: ZONE_MARGIN.top + 150 + ZONE_MARGIN.gap });
  });

  it("removing a widget restacks its zone", () => {
    useWidgetStore.getState().addWidget("clock", "small");
    useWidgetStore.getState().addWidget("calendar", "small");
    useWidgetStore.getState().addWidget("weather", "small");
    const removed = useWidgetStore.getState().widgets.find((w) => w.type === "clock")!.id;
    useWidgetStore.getState().removeWidget(removed);
    const left = useWidgetStore.getState().widgets;
    expect(left.length).toBe(2);
    for (const w of left) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(24);
    }
  });

  it("moveWidget follows the pointer, dropWidget keeps the free position", () => {
    useWidgetStore.getState().addWidget("clock", "small");
    const id = useWidgetStore.getState().widgets[0].id;
    useWidgetStore.getState().moveWidget(id, 300, 300);
    expect(useWidgetStore.getState().widgets[0]).toMatchObject({ x: 300, y: 300 });
    useWidgetStore.getState().dropWidget(id);
    expect(useWidgetStore.getState().widgets[0]).toMatchObject({ x: 300, y: 300 });
  });

  it("dropWidget clamps a position dragged off the desktop", () => {
    useWidgetStore.getState().addWidget("clock", "small");
    const id = useWidgetStore.getState().widgets[0].id;
    useWidgetStore.getState().moveWidget(id, -100, VH * 3);
    useWidgetStore.getState().dropWidget(id);
    const w = useWidgetStore.getState().widgets[0];
    expect(w.x).toBe(0);
    expect(w.y).toBe(VH - 72 - 150);
  });

  it("resizing keeps the widget inside the desktop", () => {
    useWidgetStore.getState().addWidget("calendar", "small");
    const id = useWidgetStore.getState().widgets[0].id;
    useWidgetStore.getState().resizeWidget(id, "medium");
    const resized = useWidgetStore.getState().widgets[0];
    expect(resized.size).toBe("medium");
    expect(resized.x + 460).toBeLessThanOrEqual(VW);
  });

  it("seeds Clock and Calendar defaults when no layout was ever saved", async () => {
    localStorage.removeItem("aqua.widgets");
    vi.resetModules();
    const fresh = await import("./widgetStore");
    const types = fresh.useWidgetStore.getState().widgets.map((w) => w.type);
    expect(types).toContain("clock");
    expect(types).toContain("calendar");
  });
});
