import { create } from "zustand";
import {
  clampFreePosition,
  placeInZone,
  placementForNew,
  restackWidgets,
  type WidgetSize,
  type WidgetType,
} from "./widgetLayout";

export type { WidgetSize } from "./widgetLayout";
export type { WidgetType } from "./widgetLayout";

export interface WidgetState {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  x: number;
  y: number;
}

const STORAGE_KEY = "aqua.widgets";
const PROJECTS_UNAVAILABLE = "Projects widget needs daemon /api/projects/list (Backend Phase 4.5)";

// macOS ships a couple of default widgets on a fresh desktop; seed Clock and
// Calendar the same way (both client-side, no daemon/network needed). They're
// forced into one top-right stack — the Sonoma default home — so a fresh
// desktop never looks like two unrelated cards in opposite corners.
function defaultWidgets(): WidgetState[] {
  const { w, h } = viewport();
  const clockPos = placeInZone("top-right", [], w, h, "small", "clock");
  const clock: WidgetState = { id: "default_clock", type: "clock", size: "small", ...clockPos };
  const calendarPos = placeInZone("top-right", [clock], w, h, "small", "calendar");
  return [clock, { id: "default_calendar", type: "calendar", size: "small", ...calendarPos }];
}

function viewport(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: 1600, h: 900 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function isWidgetState(v: unknown): v is WidgetState {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as WidgetState).id === "string" &&
    typeof (v as WidgetState).type === "string"
  );
}

function load(): WidgetState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Key absent = fresh install → seed defaults. `[]` is a deliberate choice
    // by the user who removed everything, so leave that empty.
    if (raw === null) return defaultWidgets();
    if (raw === "[]") return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return defaultWidgets();
    const { w, h } = viewport();
    return v
      .filter(isWidgetState)
      .map((widget) => ({ ...widget, ...clampFreePosition(widget.x, widget.y, widget.size, widget.type, w, h) }));
  } catch {
    return defaultWidgets();
  }
}

let seq = 1;
function nextId() {
  return `widget_${Date.now()}_${seq++}`;
}

function persist(widgets: WidgetState[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {}
}

interface Store {
  widgets: WidgetState[];
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  addWidget: (type: WidgetType, size: WidgetSize) => void;
  removeWidget: (id: string) => void;
  moveWidget: (id: string, x: number, y: number) => void;
  dropWidget: (id: string) => void;
  resizeWidget: (id: string, size: WidgetSize) => void;
  projectsNotice: string | null;
}

export const useWidgetStore = create<Store>((set, get) => ({
  widgets: load(),
  editMode: false,
  projectsNotice: null,
  setEditMode: (editMode) => set({ editMode }),
  addWidget: (type, size) => {
    if (type === "projects") {
      set({ projectsNotice: PROJECTS_UNAVAILABLE });
      return;
    }
    const { w, h } = viewport();
    const pos = placementForNew(get().widgets, size, type, w, h);
    const next = [...get().widgets, { id: nextId(), type, size, ...pos }];
    persist(next);
    set({ widgets: next });
  },
  removeWidget: (id) => {
    const { w, h } = viewport();
    // Re-anchor the affected zone's stack so the freed slot closes.
    const next = restackWidgets(get().widgets.filter((widget) => widget.id !== id), w, h);
    persist(next);
    set({ widgets: next });
  },
  moveWidget: (id, x, y) => {
    // Live drag follows the pointer but stays clamped inside the desktop
    // surface — a widget can never leave the screen, even if pointerup is
    // missed (mouse released outside the window).
    const { w, h } = viewport();
    const next = get().widgets.map((widget) => {
      if (widget.id !== id) return widget;
      const clamped = clampFreePosition(x, y, widget.size, widget.type, w, h);
      return { ...widget, x: clamped.x, y: clamped.y };
    });
    set({ widgets: next });
  },
  dropWidget: (id) => {
    const { w, h } = viewport();
    const next = get().widgets.map((widget) =>
      widget.id === id ? { ...widget, ...clampFreePosition(widget.x, widget.y, widget.size, widget.type, w, h) } : widget,
    );
    persist(next);
    set({ widgets: next });
  },
  resizeWidget: (id, size) => {
    const { w, h } = viewport();
    const next = get().widgets.map((widget) => {
      if (widget.id !== id) return widget;
      return { ...widget, size, ...clampFreePosition(widget.x, widget.y, size, widget.type, w, h) };
    });
    persist(next);
    set({ widgets: next });
  },
}));
