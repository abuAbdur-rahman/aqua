import { useRef } from "react";
import { useWindowStore } from "./store";
import { WindowFrame } from "./WindowFrame";

export function WindowHost() {
  const windows = useWindowStore((s) => s.windows);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="absolute inset-0">
      {windows.length === 0 && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-card border border-bg-hover bg-bg-elevated/80 px-5 py-4 text-center shadow-lg backdrop-blur">
          <p className="text-sm font-medium text-text-primary">Aqua Desktop</p>
          <p className="mt-1 max-w-[320px] text-xs leading-relaxed text-text-tertiary">
            Click a Dock icon to open a window. Drag, resize, snap to edges, double-click title to maximize, minimize to Dock.
          </p>
        </div>
      )}
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} containerRef={ref} />
      ))}
    </div>
  );
}
