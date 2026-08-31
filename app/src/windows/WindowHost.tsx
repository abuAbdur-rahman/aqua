import { useRef } from "react";
import { useWindowStore } from "./store";
import { WindowFrame } from "./WindowFrame";

export function WindowHost() {
  const windows = useWindowStore((s) => s.windows);
  const activeSpaceId = useWindowStore((s) => s.activeSpaceId);
  const ref = useRef<HTMLDivElement>(null);
  const spaceWindows = windows.filter((w) => w.spaceId === activeSpaceId);

  return (
    // `isolate` boxes every window's store-driven z-index inside this host, so
    // chrome overlays (Mission Control, Spotlight, menus) always stack above
    // them no matter how high the counter climbs.
    //
    // The host is also `pointer-events-none` so its full-surface box doesn't
    // swallow clicks meant for the widget layer underneath — windows (and the
    // empty-state hint) re-enable pointer events on their own box.
    <div ref={ref} className="pointer-events-none absolute inset-0 isolate z-0">
      {spaceWindows.length === 0 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card border border-bg-hover bg-bg-elevated/80 px-5 py-4 text-center shadow-lg backdrop-blur">
          <p className="text-sm font-medium text-text-primary">Aqua Desktop</p>
          <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-text-tertiary">
            Click a Dock icon to open a window. Drag, resize, snap to edges, double-click title to maximize, minimize to Dock.
          </p>
        </div>
      )}
      {/* Every window stays mounted across Space switches (UI-SPEC-13 §6):
          off-Space windows are hidden, not unmounted, so terminal sessions,
          scroll positions, and buffers survive the switch. */}
      {windows.map((w) => (
        <WindowFrame
          key={w.id}
          win={w}
          containerRef={ref}
          spaceVisible={w.spaceId === activeSpaceId}
        />
      ))}
    </div>
  );
}
