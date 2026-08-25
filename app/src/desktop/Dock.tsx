import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence, type MotionValue } from "framer-motion";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";
import { DOCK_MAGNIFY_DELTA, systemReducedMotion, usePrefsStore } from "../lib/prefs";

// macOS Dock principles: width/height expansion (not scale), ripple via proximity, sub-pixel weighting, bottom anchor
const PROXIMITY_RADIUS = 150;

interface DockItem {
  id: string;
  label: string;
  icon: string;
}

const DOCK_ORDER: DockItem[] = [
  { id: "finder", label: "Finder", icon: appManifest.finder.icon },
  { id: "terminal", label: "Terminal", icon: appManifest.terminal.icon },
  { id: "editor", label: "Editor", icon: appManifest.editor.icon },
  { id: "activity", label: "Activity", icon: appManifest.activity.icon },
  { id: "settings", label: "Settings", icon: appManifest.settings.icon },
];

function DockIcon({
  item,
  mouseX,
  onOpen,
  count,
  minimizedCount,
  focused,
  launching,
}: {
  item: DockItem;
  mouseX: MotionValue<number>;
  onOpen: () => void;
  count: number;
  minimizedCount: number;
  focused: boolean;
  launching: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  const baseSize = usePrefsStore((s) => s.dockSize);
  const magnifiedSize = baseSize + DOCK_MAGNIFY_DELTA;
  const reducedLaunch = systemReducedMotion();

  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const rawSize = useTransform(
    distance,
    [-PROXIMITY_RADIUS, 0, PROXIMITY_RADIUS],
    systemReducedMotion() ? [baseSize, baseSize, baseSize] : [baseSize, magnifiedSize, baseSize],
  );

  // Apple-like spring: light mass, snappy, damped — GPU not hit: only width/height layout in dock island (<7 items)
  const size = useSpring(rawSize, { mass: 0.1, stiffness: 150, damping: 12 });

  const running = count > 0 || minimizedCount > 0;
  const overflow = count > 3;

  return (
    <motion.button
      ref={ref}
      data-app-id={item.id}
      onClick={onOpen}
      aria-label={`${item.label}${running ? " running" : ""}${minimizedCount ? " minimized" : ""}`}
      title={item.label}
      onContextMenu={(e) => {
        e.preventDefault();
        const ev = new CustomEvent("aqua-dock-context", { detail: { appId: item.id, x: e.clientX, y: e.clientY } });
        window.dispatchEvent(ev);
      }}
      animate={launching && !reducedLaunch ? { y: [0, -10, 0] } : {}}
      transition={launching && !reducedLaunch ? { duration: 0.5, ease: [0.4, 0, 0.2, 1] } : {}}
      style={{ width: size, height: size } as unknown as React.CSSProperties}
      className="group relative flex shrink-0 items-center justify-center rounded-[10px] bg-bg-overlay text-text-secondary ring-1 ring-white/5 transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      <img src={item.icon} alt="" className="h-8 w-8 shrink-0 object-contain" aria-hidden="true" />
      {focused && (
        <span className="absolute -bottom-1 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" aria-hidden="true" />
      )}
      {running && !focused && (
        <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5" aria-hidden="true">
          {overflow ? (
            <span className="text-[9px] font-medium leading-none text-accent">+{count}</span>
          ) : (
            Array.from({ length: Math.min(count || minimizedCount, 3) }).map((_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" />
            ))
          )}
        </span>
      )}
      {/* tooltip — scale on hover, GPU transform only */}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 scale-0 whitespace-nowrap rounded bg-bg-overlay px-2 py-1 text-xs text-text-primary shadow-lg ring-1 ring-white/10 transition-transform duration-150 group-hover:scale-100">
        {item.label}
      </span>
    </motion.button>
  );
}

export function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const openApp = useWindowStore((s) => s.openApp);
  const restore = useWindowStore((s) => s.restore);
  const focusedId = windows.find((w) => w.focused && !w.minimized)?.appId ?? null;

  const mouseX = useMotionValue<number>(Infinity);
  const [ctx, setCtx] = useState<{ appId: string; x: number; y: number } | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);

  useEffect(() => {
    const onCtx = (e: Event) => {
      const ce = e as CustomEvent<{ appId: string; x: number; y: number }>;
      setCtx(ce.detail);
    };
    const onDown = () => setCtx(null);
    window.addEventListener("aqua-dock-context", onCtx as EventListener);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("aqua-dock-context", onCtx as EventListener);
      window.removeEventListener("mousedown", onDown);
    };
  }, []);

  const handleOpen = (appId: string) => {
    const minimized = windows.find((w) => w.appId === appId && w.minimized);
    if (minimized) {
      restore(minimized.id);
      return;
    }
    const already = windows.some((w) => w.appId === appId && !w.minimized);
    if (!already) {
      setLaunching(appId);
      window.setTimeout(() => setLaunching(null), 600);
    }
    openApp(appId);
  };

  const countFor = (appId: string) => windows.filter((w) => w.appId === appId && !w.minimized).length;
  const minCountFor = (appId: string) => windows.filter((w) => w.appId === appId && w.minimized).length;

  // Trash also participates in magnification — same physics, separate motion value via shared mouseX
  const baseSize = usePrefsStore((s) => s.dockSize);
  const trashRef = useRef<HTMLButtonElement>(null);
  const trashDist = useTransform(mouseX, (val: number) => {
    const b = trashRef.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - b.x - b.width / 2;
  });
  const reduced = systemReducedMotion();
  const trashRaw = useTransform(
    trashDist,
    [-PROXIMITY_RADIUS, 0, PROXIMITY_RADIUS],
    reduced ? [baseSize, baseSize, baseSize] : [baseSize, baseSize + DOCK_MAGNIFY_DELTA, baseSize],
  );
  const trashSize = useSpring(trashRaw, { mass: 0.1, stiffness: 150, damping: 12 });

  return (
    <>
      <div className="fixed bottom-2 left-1/2 z-[2147483647] flex -translate-x-1/2 items-end justify-center">
        <motion.div
          onMouseMove={(e) => mouseX.set(e.pageX)}
          onMouseLeave={() => mouseX.set(Infinity)}
          className="flex h-16 items-end gap-3 rounded-2xl border border-white/[0.08] bg-bg-elevated/95 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.06)_inset] backdrop-blur-xl"
        >
          {DOCK_ORDER.map((item) => (
            <DockIcon
              key={item.id}
              item={item}
              mouseX={mouseX}
              onOpen={() => handleOpen(item.id)}
              count={countFor(item.id)}
              minimizedCount={minCountFor(item.id)}
              focused={focusedId === item.id}
              launching={launching === item.id}
            />
          ))}
          <div className="mx-1 h-7 w-px self-center bg-white/10" aria-hidden="true" />
          <motion.button
            ref={trashRef}
            aria-label="Trash"
            title="Trash"
            style={{ width: trashSize, height: trashSize } as unknown as React.CSSProperties}
            className="flex shrink-0 items-center justify-center rounded-[10px] bg-bg-overlay text-text-tertiary ring-1 ring-white/5 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <img src="/icons/icon-trash.svg" alt="" className="h-8 w-8 object-contain" aria-hidden="true" />
          </motion.button>
        </motion.div>
      </div>

      <AnimatePresence>
        {ctx && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            style={{ left: ctx.x, top: ctx.y - 80, willChange: "transform, opacity" } as React.CSSProperties}
            className="fixed z-[2147483647] w-44 rounded-card border border-bg-hover bg-bg-overlay p-1 shadow-[0_16px_32px_rgba(0,0,0,0.4)]"
          >
            <button
              onClick={() => {
                windows.filter((w) => w.appId === ctx.appId && w.minimized).forEach((w) => restore(w.id));
                setCtx(null);
              }}
              className="w-full rounded px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              Show All Windows
            </button>
            <button
              onClick={() => {
                const win = windows.find((w) => w.appId === ctx.appId && !w.minimized);
                if (win) useWindowStore.getState().minimize(win.id);
                setCtx(null);
              }}
              className="w-full rounded px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              Minimize
            </button>
            <button
              onClick={() => {
                windows.filter((w) => w.appId === ctx.appId).forEach((w) => useWindowStore.getState().close(w.id));
                setCtx(null);
              }}
              className="w-full rounded px-3 py-1.5 text-left text-xs text-status-danger hover:bg-status-danger/10"
            >
              Quit
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
