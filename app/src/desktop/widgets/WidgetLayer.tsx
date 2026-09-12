import { useRef, useState } from "react";
import { FiMove, FiX } from "react-icons/fi";
import { ClockWidget } from "./ClockWidget";
import { CalendarWidget } from "./CalendarWidget";
import { SystemMonitorWidget } from "./SystemMonitorWidget";
import { StorageWidget } from "./StorageWidget";
import { TrashPreviewWidget } from "./TrashPreviewWidget";
import { WeatherWidget } from "./WeatherWidget";
import { useWidgetStore, type WidgetState } from "./widgetStore";
import { widgetSize } from "./widgetLayout";

function renderWidget(w: WidgetState) {
  switch (w.type) {
    case "clock": return <ClockWidget size={w.size} />;
    case "calendar": return <CalendarWidget size={w.size} />;
    case "systemMonitor": return <SystemMonitorWidget size={w.size} />;
    case "storage": return <StorageWidget size={w.size} />;
    case "trashPreview": return <TrashPreviewWidget />;
    case "weather": return <WeatherWidget size={w.size} id={w.id} />;
    default: return <div className="p-4 text-xs text-text-tertiary">{w.type} (needs backend)</div>;
  }
}

// Edit-mode control chrome per APPEND_WIDGETS_VISUAL §5: two small circular
// controls (drag handle + remove), rgba(20,20,24,0.7) with a 6px blur
// backdrop, 22px diameter, sitting above the widget content.
const CONTROL_BG = "rgba(20, 20, 24, 0.7)";

function Control({
  label,
  onClick,
  onPointerDown,
  hoverClass,
  children,
}: {
  label: string;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  hoverClass?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onPointerDown={onPointerDown}
      onClick={onClick}
      className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-text-secondary transition-colors duration-120 ${hoverClass ?? "hover:text-text-primary"}`}
      style={{ background: CONTROL_BG, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
    >
      {children}
    </button>
  );
}

export function WidgetLayer() {
  const widgets = useWidgetStore((s) => s.widgets);
  const editMode = useWidgetStore((s) => s.editMode);
  const moveWidget = useWidgetStore((s) => s.moveWidget);
  const dropWidget = useWidgetStore((s) => s.dropWidget);
  const removeWidget = useWidgetStore((s) => s.removeWidget);
  const resizeWidget = useWidgetStore((s) => s.resizeWidget);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string, fromHandle = false) => {
    // Plain clicks land on interactive children (remove/resize/content buttons)
    // and must not start a drag — the handle is the explicit exception.
    if (!fromHandle && (e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget as HTMLElement).closest("[data-widget]") as HTMLElement | null;
    const rect = box?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    dragRef.current = { id, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setDraggingId(id);
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      moveWidget(dragRef.current.id, ev.clientX - dragRef.current.dx, ev.clientY - dragRef.current.dy);
    };
    const onUp = () => {
      const active = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      if (active) dropWidget(active.id);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onBlur);
    };
    const onBlur = () => onUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onBlur);
  };

  if (!widgets.length && !editMode) return null;
  return (
    // `fixed` (not absolute) puts the layer in viewport space, so `left`/`top`
    // match pointer coordinates directly — otherwise drag positions would be
    // offset by the surface container's 24px top inset and drift in Y.
    <div className="pointer-events-none fixed inset-0 z-0">
      {widgets.map((w) => {
        const { w: width, h: height } = widgetSize(w.size, w.type);
        const isDragging = draggingId === w.id;
        return (
          <div
            key={w.id}
            data-widget
            className={`widget-glass group pointer-events-auto absolute flex cursor-grab flex-col transition-[transform,box-shadow] duration-150 active:cursor-grabbing ${editMode ? "ring-1 ring-accent/40" : ""} ${isDragging ? "scale-[1.03] opacity-95" : ""}`}
            style={{
              left: w.x,
              top: w.y,
              width,
              height,
              touchAction: "none",
            }}
            onPointerDown={(e) => startDrag(e, w.id)}
          >
            {/* Controls sit above the sheen/content; edit mode keeps them
                visible, normal mode reveals them on hover. */}
            <div
              className={`pointer-events-none absolute inset-x-0 top-2.5 z-10 flex items-center justify-between px-2.5 transition-opacity duration-120 ${editMode ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}
            >
              <Control
                label={`Move ${w.type} widget`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startDrag(e, w.id, true);
                }}
              >
                <FiMove size={12} aria-hidden="true" />
              </Control>
              {editMode && (
                <button
                  aria-label={`${w.size === "small" ? "Enlarge" : "Shrink"} ${w.type} widget`}
                  title="Toggle size"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => resizeWidget(w.id, w.size === "small" ? "medium" : "small")}
                  className="flex h-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium uppercase tracking-wide text-text-secondary transition-colors duration-120 hover:text-text-primary"
                  style={{ background: CONTROL_BG, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
                >
                  {w.size === "small" ? "S" : "M"}
                </button>
              )}
              <Control
                label={`Remove ${w.type} widget`}
                onClick={() => removeWidget(w.id)}
                hoverClass="hover:text-status-danger"
              >
                <FiX size={12} aria-hidden="true" />
              </Control>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{renderWidget(w)}</div>
          </div>
        );
      })}
    </div>
  );
}
