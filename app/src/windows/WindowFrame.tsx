import { useRef, useCallback, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { appManifest } from "./manifest";
import { useWindowStore, type WindowRecord } from "./store";
import { FinderPane } from "../panes/FinderPane";
import { TerminalPane } from "../panes/TerminalPane";
import { ActivityPane } from "../panes/ActivityPane";
import { EditorPane } from "../panes/EditorPane";
import { SpotlightPane } from "../panes/SpotlightPane";

type Props = {
  win: WindowRecord;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

const SNAP = 12;
const TITLE_H = 28;

function useReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function dockOrigin(appId: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-app-id="${appId}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function WindowFrame({ win, containerRef }: Props) {
  const focus = useWindowStore((s) => s.focus);
  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const updateBounds = useWindowStore((s) => s.updateBounds);
  const toggleMaximize = useWindowStore((s) => s.toggleMaximize);

  const [titleHover, setTitleHover] = useState(false);
  const reduced = useReducedMotion();

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
      pendingRef.current = next;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  const onTitlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    focus(win.id);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: win.x, oy: win.y };
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      let x = dragRef.current.ox + (ev.clientX - dragRef.current.x);
      let y = dragRef.current.oy + (ev.clientY - dragRef.current.y);
      const c = containerRef.current?.getBoundingClientRect();
      if (c) {
        if (Math.abs(x) < SNAP) x = 0;
        if (Math.abs(y) < SNAP) y = 0;
        if (Math.abs(x + win.w - c.width) < SNAP) x = c.width - win.w;
        if (Math.abs(y + win.h - c.height) < SNAP) y = c.height - win.h;
        x = Math.max(-win.w + 80, Math.min(x, c.width - 80));
        y = Math.max(0, Math.min(y, c.height - TITLE_H));
      }
      schedule({ x, y, w: win.w, h: win.h });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onResizePointerDown = (e: React.PointerEvent, dir: string) => {
    e.stopPropagation();
    e.preventDefault();
    focus(win.id);
    const start = { x: e.clientX, y: e.clientY, w: win.w, h: win.h, ox: win.x, oy: win.y };
    const manifest = appManifest[win.appId];
    const minW = manifest?.minSize.w ?? 320;
    const minH = manifest?.minSize.h ?? 200;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      let x = start.ox,
        y = start.oy,
        w = start.w,
        h = start.h;
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
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const manifest = appManifest[win.appId];
  const Icon = manifest?.icon;
  const titleEmDash = manifest ? `${manifest.name} — ${win.title.replace(`${manifest.name} — `, "")}` : win.title;

  // GPU-only motion: transform + opacity, no layout thrash
  const origin = useMemo(() => dockOrigin(win.appId), [win.appId]);
  const containerRect = containerRef.current?.getBoundingClientRect();
  const initialTranslate = origin && containerRect ? { x: origin.x - containerRect.left - win.x - win.w / 2, y: origin.y - containerRect.top - win.y - win.h / 2 } : { x: 0, y: 12 };

  if (win.minimized) return null;

  const trafficOpacity = win.focused ? 1 : titleHover ? 1 : 0.35;
  const trafficRestOpacity = win.focused ? 0.92 : 0.6;

  return (
    <motion.div
      role="dialog"
      aria-label={win.title}
      aria-modal="false"
      onMouseDown={() => focus(win.id)}
      initial={reduced ? false : { opacity: 0, scale: 0.96, x: initialTranslate.x, y: initialTranslate.y }}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, x: initialTranslate.x, y: initialTranslate.y }}
      transition={
        reduced
          ? { duration: 0.01 }
          : { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const }
      }
      className={`absolute flex flex-col overflow-hidden rounded-window border bg-bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.5),0_1px_0_rgba(255,255,255,0.06)_inset] ${win.focused ? "border-accent/30 shadow-[0_16px_48px_rgba(0,0,0,0.55),0_0_0_1px_rgba(34,211,238,0.15)]" : "border-bg-hover"}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.w,
        height: win.h,
        zIndex: win.z,
        willChange: "transform, opacity",
      }}
    >
      {/* Title bar 28px per DESIGN.md */}
      <div
        onPointerDown={onTitlePointerDown}
        onDoubleClick={() => {
          const c = containerRef.current?.getBoundingClientRect();
          if (c) toggleMaximize(win.id, { w: c.width, h: c.height });
        }}
        onMouseEnter={() => setTitleHover(true)}
        onMouseLeave={() => setTitleHover(false)}
        className={`flex h-7 shrink-0 select-none items-center border-b pl-4 pr-3 ${win.focused ? "bg-bg-elevated border-bg-hover" : "bg-bg-overlay/70 border-transparent"}`}
        style={{ touchAction: "none" }}
      >
        {/* Traffic lights 12px, 8px gap, 16px inset */}
        <div className="flex items-center gap-2" style={{ opacity: titleHover ? trafficOpacity : win.focused ? trafficRestOpacity : 0.35, transition: "opacity 120ms ease-out" }}>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => close(win.id)}
            aria-label={`Close ${win.title}`}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-status-danger text-[8px] font-bold leading-none text-bg-surface ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="opacity-0 group-hover:opacity-100" style={{ opacity: titleHover || win.focused ? 1 : 0 }}>
              ×
            </span>
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => minimize(win.id)}
            aria-label={`Minimize ${win.title}`}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-status-warning text-[8px] font-bold leading-none text-bg-surface ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span style={{ opacity: titleHover || win.focused ? 1 : 0 }}>–</span>
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const c = containerRef.current?.getBoundingClientRect();
              if (c) toggleMaximize(win.id, { w: c.width, h: c.height });
            }}
            aria-label={win.maximized ? `Restore ${win.title}` : `Maximize ${win.title}`}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-status-success text-[7px] leading-none text-bg-surface ring-1 ring-black/10 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span style={{ opacity: titleHover || win.focused ? 1 : 0 }}>⤢</span>
          </button>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />}
          <span className={`truncate text-[13px] font-medium leading-none ${win.focused ? "text-text-primary" : "text-text-tertiary"}`}>{titleEmDash}</span>
        </div>

        <div className="w-[52px]" aria-hidden="true" />
      </div>

      {/* Content — scaffolded 4-state panes per UI-SPEC-02..06 (real data wiring in Phases 2-6) */}
      <div className="flex-1 overflow-auto bg-bg-surface">
        {win.appId === "finder" && <FinderPane />}
        {win.appId === "terminal" && <TerminalPane state="connected" />}
        {win.appId === "activity" && <ActivityPane state="populated" />}
        {win.appId === "editor" && <EditorPane state="populated" />}
        {win.appId === "spotlight" && <SpotlightPane open />}
        {!["finder", "terminal", "activity", "editor", "spotlight"].includes(win.appId) && (
          <div id={`win-content-${win.id}`} className="h-full" />
        )}
      </div>

      {/* Resize handles: 4px invisible hit-zone, cursor only, no visible line */}
      <div onPointerDown={(e) => onResizePointerDown(e, "n")} className="absolute left-3 right-3 top-0 h-1 cursor-n-resize" style={{ height: 4 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "s")} className="absolute bottom-0 left-3 right-3 cursor-s-resize" style={{ height: 4 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "w")} className="absolute bottom-3 left-0 top-7 cursor-w-resize" style={{ width: 4 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "e")} className="absolute bottom-3 right-0 top-7 cursor-e-resize" style={{ width: 4 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "nw")} className="absolute left-0 top-0 cursor-nw-resize" style={{ width: 12, height: 12 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "ne")} className="absolute right-0 top-0 cursor-ne-resize" style={{ width: 12, height: 12 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "sw")} className="absolute bottom-0 left-0 cursor-sw-resize" style={{ width: 12, height: 12 }} aria-hidden="true" />
      <div onPointerDown={(e) => onResizePointerDown(e, "se")} className="absolute bottom-0 right-0 cursor-se-resize" style={{ width: 16, height: 16 }} aria-hidden="true" />
    </motion.div>
  );
}
