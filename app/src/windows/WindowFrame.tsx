import { useRef, useCallback } from "react";
import { appManifest } from "./manifest";
import { useWindowStore, type WindowRecord } from "./store";

type Props = {
  win: WindowRecord;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

const SNAP = 12;
const TITLE_H = 28;

export function WindowFrame({ win, containerRef }: Props) {
  const focus = useWindowStore((s) => s.focus);
  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const updateBounds = useWindowStore((s) => s.updateBounds);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);

  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<Pick<WindowRecord, "x" | "y" | "w" | "h"> | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (pendingRef.current) {
      updateBounds(win.id, pendingRef.current);
      pendingRef.current = null;
    }
  }, [updateBounds, win.id]);

  const schedule = useCallback(
    (next: Pick<WindowRecord, "x" | "y" | "w" | "h">) => {
      pendingRef.current = { ...win, ...next };
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    },
    [flush, win],
  );

  const onTitlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    focus(win.id);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: win.x, oy: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      let x = dragRef.current.ox + (ev.clientX - dragRef.current.x);
      let y = dragRef.current.oy + (ev.clientY - dragRef.current.y);
      const c = containerRef.current?.getBoundingClientRect();
      if (c) {
        // edge snap
        if (Math.abs(x) < SNAP) x = 0;
        if (Math.abs(y) < SNAP) y = 0;
        if (Math.abs(x + win.w - c.width) < SNAP) x = c.width - win.w;
        if (Math.abs(y + win.h - c.height) < SNAP) y = c.height - win.h;
        x = Math.max(-win.w + 80, Math.min(x, c.width - 80));
        y = Math.max(0, Math.min(y, c.height - TITLE_H));
      }
      schedule({ x, y, w: win.w, h: win.h });
    };
    const onUp = (ev: PointerEvent) => {
      (e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onResizePointerDown = (e: React.PointerEvent, dir: string) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    focus(win.id);
    const start = { x: e.clientX, y: e.clientY, w: win.w, h: win.h, ox: win.x, oy: win.y };
    const manifest = appManifest[win.appId];
    const minW = manifest?.minSize.w ?? 320;
    const minH = manifest?.minSize.h ?? 200;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let x = start.ox, y = start.oy, w = start.w, h = start.h;

      if (dir.includes("e")) w = Math.max(minW, start.w + dx);
      if (dir.includes("s")) h = Math.max(minH, start.h + dy);
      if (dir.includes("w")) {
        const nw = Math.max(minW, start.w - dx);
        x = start.ox + (start.w - nw);
        w = nw;
      }
      if (dir.includes("n")) {
        const nh = Math.max(minH, start.h - dy);
        y = start.oy + (start.h - nh);
        h = nh;
      }
      const c = containerRef.current?.getBoundingClientRect();
      if (c) {
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x + w > c.width) w = c.width - x;
        if (y + h > c.height) h = c.height - y;
      }
      schedule({ x, y, w, h });
    };
    const onUp = (ev: PointerEvent) => {
      (e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const Icon = appManifest[win.appId]?.icon;

  if (win.minimized) return null;

  return (
    <div
      role="dialog"
      aria-label={win.title}
      aria-modal="false"
      onMouseDown={() => focus(win.id)}
      className={`absolute flex flex-col overflow-hidden rounded-window border bg-bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.06)_inset] transition-[box-shadow,border-color] duration-[220ms] ${win.focused ? "border-accent/30 shadow-[0_16px_48px_rgba(0,0,0,0.55),0_0_0_1px_rgba(34,211,238,0.15)]" : "border-bg-hover"}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        // transform-based perf: already absolute, but keep willChange for drag
        willChange: "transform",
      }}
    >
      {/* Title bar 28px per DESIGN.md */}
      <div
        onPointerDown={onTitlePointerDown}
        onDoubleClick={() => {
          const c = containerRef.current?.getBoundingClientRect();
          if (c) toggleMaximize(win.id, { w: c.width, h: c.height });
        }}
        className={`flex h-7 shrink-0 select-none items-center gap-3 border-b px-3 ${win.focused ? "bg-bg-elevated border-bg-hover" : "bg-bg-overlay/70 border-transparent"}`}
        style={{ touchAction: "none" }}
      >
        {/* Traffic lights 12px, 8px gap */}
        <div className="flex items-center gap-2" aria-hidden="true">
          <button
            onClick={() => close(win.id)}
            aria-label={`Close ${win.title}`}
            className="h-3 w-3 rounded-full bg-status-danger ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            onClick={() => minimize(win.id)}
            aria-label={`Minimize ${win.title}`}
            className="h-3 w-3 rounded-full bg-status-warning ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          />
          <button
            onClick={() => {
              const c = containerRef.current?.getBoundingClientRect();
              if (c) toggleMaximize(win.id, { w: c.width, h: c.height });
            }}
            aria-label={win.maximized ? `Restore ${win.title}` : `Maximize ${win.title}`}
            className="h-3 w-3 rounded-full bg-status-success ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />}
          <span className="truncate text-[13px] font-medium leading-none text-text-secondary">{win.title}</span>
        </div>

        <div className="w-[52px]" aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto bg-bg-surface p-4">
        <div className="rounded-card border border-dashed border-bg-hover bg-bg-overlay/40 p-6">
          <p className="text-sm font-medium text-text-primary">{win.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
            Generic window — drag via title bar, resize from edges/corners, double-click title to maximize, edge-snap at {SNAP}px, minimize-to-Dock (320ms handled by Dock restore).
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => minimize(win.id)}
              className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
            >
              Minimize
            </button>
            <button
              onClick={() => close(win.id)}
              className="rounded-card border border-bg-hover bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Resize handles (8px) */}
      <div onPointerDown={(e) => onResizePointerDown(e, "n")} className="absolute left-2 right-2 top-0 h-1 cursor-n-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "s")} className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "w")} className="absolute bottom-2 left-0 top-7 w-1 cursor-w-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "e")} className="absolute bottom-2 right-0 top-7 w-1 cursor-e-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "nw")} className="absolute left-0 top-0 h-3 w-3 cursor-nw-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "ne")} className="absolute right-0 top-0 h-3 w-3 cursor-ne-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "sw")} className="absolute bottom-0 left-0 h-3 w-3 cursor-sw-resize" aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "se")} className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize" aria-hidden="true" />
    </div>
  );
}
