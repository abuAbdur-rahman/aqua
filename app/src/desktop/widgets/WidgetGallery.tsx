import { useMemo } from "react";
import {
  FiCheck,
  FiClock,
  FiCalendar,
  FiCloud,
  FiCpu,
  FiHardDrive,
  FiPlus,
  FiTrash2,
} from "react-icons/fi";
import { useWidgetStore, type WidgetType } from "./widgetStore";

const CATALOG: { type: WidgetType; label: string; desc: string; icon: React.ReactNode }[] = [
  { type: "clock", label: "Clock", desc: "Time + date", icon: <FiClock aria-hidden="true" /> },
  { type: "calendar", label: "Calendar", desc: "Month grid", icon: <FiCalendar aria-hidden="true" /> },
  { type: "systemMonitor", label: "System Monitor", desc: "CPU / MEM", icon: <FiCpu aria-hidden="true" /> },
  { type: "storage", label: "Storage", desc: "Disk usage", icon: <FiHardDrive aria-hidden="true" /> },
  { type: "trashPreview", label: "Trash", desc: "Count + Empty", icon: <FiTrash2 aria-hidden="true" /> },
  { type: "weather", label: "Weather", desc: "Temp + forecast", icon: <FiCloud aria-hidden="true" /> },
];

function SizePill({
  label,
  count,
  onAdd,
}: {
  label: string;
  count: number;
  onAdd: () => void;
}) {
  const active = count > 0;
  return (
    <button
      onClick={onAdd}
      className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors ${active ? "border-accent/60 bg-accent-bg text-accent" : "border-bg-hover bg-bg-elevated text-text-secondary hover:border-accent/40 hover:text-text-primary"}`}
    >
      {active && <FiCheck size={11} aria-hidden="true" />}
      {label}
      {count > 1 && <span className="tabular-nums text-[10px] opacity-70">×{count}</span>}
    </button>
  );
}

// Floating catalog, macOS "Add Widgets"-style: a panel over the desktop, never
// a full-screen backdrop — widgets behind it stay visible and draggable. Each
// card reflects the live state of what's already on the desktop.
export function WidgetGallery({ onClose }: { onClose: () => void }) {
  const addWidget = useWidgetStore((s) => s.addWidget);
  const widgets = useWidgetStore((s) => s.widgets);

  const typeCounts = useMemo(() => {
    const map = new Map<WidgetType, number>();
    for (const w of widgets) map.set(w.type, (map.get(w.type) ?? 0) + 1);
    return map;
  }, [widgets]);

  const sizeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of widgets) map.set(`${w.type}:${w.size}`, (map.get(`${w.type}:${w.size}`) ?? 0) + 1);
    return map;
  }, [widgets]);

  const onDesktopCount = widgets.length;

  return (
    <div className="pointer-events-auto fixed bottom-[92px] left-1/2 z-30 w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-window border border-bg-hover bg-bg-elevated/95 p-4 shadow-[0_24px_64px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Edit Widgets</h2>
          <p className="text-[11px] text-text-tertiary">
            {onDesktopCount} {onDesktopCount === 1 ? "widget" : "widgets"} on desktop
          </p>
        </div>
        <button className="rounded bg-accent px-3 py-1 text-xs font-medium text-bg-base hover:bg-accent-strong" onClick={onClose}>Done</button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {CATALOG.map((c) => {
          const count = typeCounts.get(c.type) ?? 0;
          return (
            <div key={c.type} className="flex flex-col rounded-card border border-bg-hover bg-bg-surface/60 p-3 transition-colors hover:border-accent/40">
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-lg text-accent">
                  {c.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-primary">{c.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-text-tertiary">{c.desc}</p>
                </div>
                {count > 0 && (
                  <span className="shrink-0 rounded-full bg-accent-bg px-2 py-0.5 text-[10px] font-semibold text-accent">
                    {count} on desktop
                  </span>
                )}
              </div>
              <div className="mt-3 flex gap-1.5">
                <SizePill label="Small" count={sizeCounts.get(`${c.type}:small`) ?? 0} onAdd={() => addWidget(c.type, "small")} />
                <SizePill label="Medium" count={sizeCounts.get(`${c.type}:medium`) ?? 0} onAdd={() => addWidget(c.type, "medium")} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-text-tertiary">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-bg-hover" aria-hidden="true" />
        Projects needs the daemon /api/projects/list endpoint (Backend Phase 4.5) — not added in this app-only pass.
      </p>
    </div>
  );
}

// Non-blocking edit-mode chrome: floats above the Dock, leaves the desktop
// interactive so widgets can be dragged/removed while it's visible.
export function WidgetToolbar({
  catalogOpen,
  onToggleCatalog,
  onDone,
}: {
  catalogOpen: boolean;
  onToggleCatalog: () => void;
  onDone: () => void;
}) {
  const widgetCount = useWidgetStore((s) => s.widgets.length);
  return (
    <div className="pointer-events-auto fixed bottom-[84px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-bg-hover bg-bg-elevated/90 px-4 py-2 shadow-lg backdrop-blur">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-bg text-accent">
        <FiPlus size={12} aria-hidden="true" />
      </span>
      <span className="text-xs font-medium text-text-primary">Edit Widgets</span>
      <span className="rounded-full bg-bg-hover px-2 py-0.5 text-[10px] font-medium tabular-nums text-text-secondary">
        {widgetCount} {widgetCount === 1 ? "widget" : "widgets"}
      </span>
      <span className="hidden text-[11px] text-text-tertiary md:inline">Drag to move · hover a widget to remove</span>
      <button
        className="flex items-center gap-1 rounded bg-bg-hover px-2.5 py-1 text-xs font-medium text-text-primary hover:bg-bg-hover/80"
        onClick={onToggleCatalog}
      >
        <FiPlus size={12} aria-hidden="true" />
        {catalogOpen ? "Close" : "Add Widget"}
      </button>
      <button className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-bg-base hover:bg-accent-strong" onClick={onDone}>Done</button>
    </div>
  );
}
