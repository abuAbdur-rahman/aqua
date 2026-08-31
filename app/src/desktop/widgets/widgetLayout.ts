export type WidgetSize = "small" | "medium";
export type WidgetType =
  | "systemMonitor"
  | "storage"
  | "clock"
  | "trashPreview"
  | "calendar"
  | "weather"
  | "projects";

export type Zone = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const ZONES: Zone[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

// Widget layer lives in viewport space (position: fixed) so pointer
// coordinates map straight onto card positions. The surface reserves the top
// 24px for the Menu bar and the bottom 72px for the Dock.
export const SURFACE_TOP = 24;
export const DOCK_H = 72;

// Zone margins (px) measured from the real screen edges; stacks keep a 20px
// gap between cards.
export const ZONE_MARGIN = { x: 56, top: 56, bottom: DOCK_H + 16, gap: 20 } as const;

// Fixed card dimensions. Widths rhyme across widgets (220 small / 460 medium)
// so columns align; heights vary per widget so each card fits its content.
// Clock stays compact — a time and date never needs a full-width card.
const DIMS: Record<WidgetType, Record<WidgetSize, { w: number; h: number }>> = {
  clock: { small: { w: 220, h: 150 }, medium: { w: 300, h: 160 } },
  calendar: { small: { w: 220, h: 252 }, medium: { w: 460, h: 304 } },
  weather: { small: { w: 220, h: 264 }, medium: { w: 460, h: 316 } },
  systemMonitor: { small: { w: 220, h: 200 }, medium: { w: 460, h: 230 } },
  storage: { small: { w: 220, h: 170 }, medium: { w: 460, h: 210 } },
  trashPreview: { small: { w: 220, h: 160 }, medium: { w: 460, h: 180 } },
  projects: { small: { w: 220, h: 220 }, medium: { w: 460, h: 220 } },
};

export function widgetSize(size: WidgetSize, type?: WidgetType): { w: number; h: number } {
  if (type && DIMS[type]) return DIMS[type][size];
  return size === "small" ? { w: 220, h: 220 } : { w: 460, h: 220 };
}

export interface PlacedWidget {
  x: number;
  y: number;
  size: WidgetSize;
  type?: WidgetType;
}

export function zoneOf(w: { x: number; y: number }, viewportW: number, viewportH: number): Zone {
  const left = w.x < viewportW / 2;
  const top = w.y < viewportH / 2;
  return left ? (top ? "top-left" : "bottom-left") : top ? "top-right" : "bottom-right";
}

function inZone(zone: Zone, widgets: PlacedWidget[], viewportW: number, viewportH: number): PlacedWidget[] {
  return widgets.filter((w) => zoneOf(w, viewportW, viewportH) === zone);
}

function zoneX(zone: Zone, viewportW: number, w: number): number {
  return zone.endsWith("left") ? ZONE_MARGIN.x : viewportW - ZONE_MARGIN.x - w;
}

function stackUsedHeight(widgets: PlacedWidget[]): number {
  let used = 0;
  for (const w of widgets) used += widgetSize(w.size, w.type).h + ZONE_MARGIN.gap;
  return used;
}

export function zoneRoom(zone: Zone, widgets: PlacedWidget[], viewportW: number, viewportH: number): number {
  const used = stackUsedHeight(inZone(zone, widgets, viewportW, viewportH));
  return viewportH - ZONE_MARGIN.top - ZONE_MARGIN.bottom - used;
}

export function bestZoneForNew(
  widgets: PlacedWidget[],
  viewportW: number,
  viewportH: number,
): Zone {
  let best: Zone = ZONES[0];
  let bestRoom = -Infinity;
  for (const zone of ZONES) {
    const room = zoneRoom(zone, widgets, viewportW, viewportH);
    if (room > bestRoom) {
      bestRoom = room;
      best = zone;
    }
  }
  return best;
}

export function placeInZone(
  zone: Zone,
  widgets: PlacedWidget[],
  viewportW: number,
  viewportH: number,
  size: WidgetSize,
  type?: WidgetType,
): { x: number; y: number } {
  const { w, h } = widgetSize(size, type);
  const x = zoneX(zone, viewportW, w);
  const stack = inZone(zone, widgets, viewportW, viewportH);
  const used = stackUsedHeight(stack);
  let y: number;
  if (zone.startsWith("top")) {
    y = ZONE_MARGIN.top + used;
    y = Math.min(y, viewportH - ZONE_MARGIN.bottom - h);
  } else {
    y = viewportH - ZONE_MARGIN.bottom - h - used;
    y = Math.max(y, ZONE_MARGIN.top);
  }
  return { x, y };
}

// New widgets cluster into the zone of the most recently added widget so the
// desktop looks intentional (a group), only spilling to another zone once the
// first one is full. The very first widget anchors top-right, macOS-style.
export function placementForNew(
  widgets: PlacedWidget[],
  size: WidgetSize,
  type: WidgetType | undefined,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  if (widgets.length === 0) {
    return placeInZone("top-right", [], viewportW, viewportH, size, type);
  }
  const last = widgets[widgets.length - 1];
  const lastZone = zoneOf(last, viewportW, viewportH);
  const { h } = widgetSize(size, type);
  if (zoneRoom(lastZone, widgets, viewportW, viewportH) >= h + ZONE_MARGIN.gap) {
    return placeInZone(lastZone, widgets, viewportW, viewportH, size, type);
  }
  return placeInZone(bestZoneForNew(widgets, viewportW, viewportH), widgets, viewportW, viewportH, size, type);
}

// After a removal, re-anchor each zone's stack to the corner so the freed slot
// closes instead of leaving a hole.
export function restackWidgets<T extends PlacedWidget>(
  widgets: T[],
  viewportW: number,
  viewportH: number,
): T[] {
  const result: T[] = [];
  for (const zone of ZONES) {
    const stack = inZone(zone, widgets, viewportW, viewportH);
    const placed: T[] = [];
    for (const w of stack) {
      const { x, y } = placeInZone(zone, placed, viewportW, viewportH, w.size, w.type);
      placed.push({ ...w, x, y } as T);
    }
    result.push(...placed);
  }
  return result;
}

// Free absolute positioning: a dragged widget stays where dropped, only kept
// inside the usable desktop (below the Menu bar, above the Dock).
export function clampFreePosition(
  x: number,
  y: number,
  size: WidgetSize,
  type: WidgetType | undefined,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  const { w, h } = widgetSize(size, type);
  return {
    x: Math.max(0, Math.min(x, viewportW - w)),
    y: Math.max(SURFACE_TOP, Math.min(y, viewportH - DOCK_H - h)),
  };
}
