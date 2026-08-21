import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from "framer-motion";
import { FiFolder, FiTerminal, FiCpu, FiCode, FiSearch, FiTrash2 } from "react-icons/fi";
import { useWindowStore } from "../windows/store";


interface DockItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const DOCK_ORDER: DockItem[] = [
  { id: "finder", label: "Finder", icon: FiFolder },
  { id: "terminal", label: "Terminal", icon: FiTerminal },
  { id: "editor", label: "Editor", icon: FiCode },
  { id: "activity", label: "Activity", icon: FiCpu },
  { id: "spotlight", label: "Spotlight", icon: FiSearch },
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
  mouseX: ReturnType<typeof useMotionValue<number>>;
  onOpen: () => void;
  count: number;
  minimizedCount: number;
  focused: boolean;
  launching: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const distance = useTransform(mouseX, (val: number) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return val - (bounds.left + bounds.width / 2);
  });
  // proximity magnify 48→64: scale 1 → 1.33, only within ~120px
  const scaleRaw = useTransform(distance, [-140, 0, 140], [1, 1.33, 1]);
  const scale = useSpring(scaleRaw, { stiffness: 400, damping: 30, mass: 0.4 });

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
        // dispatch custom event for context menu; parent handles
        const ev = new CustomEvent("aqua-dock-context", { detail: { appId: item.id, x: e.clientX, y: e.clientY } });
        window.dispatchEvent(ev);
      }}
      animate={launching ? { y: [0, -10, 0] } : {}}
      transition={launching ? { duration: 0.5, ease: [0.4, 0, 0.2, 1] } : {}}
      style={{ scale, willChange: "transform" } as unknown as React.CSSProperties}
      className="group relative flex flex-col items-center rounded-card p-1 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-[10px] bg-bg-overlay text-text-secondary ring-1 ring-white/5 transition-colors group-hover:text-text-primary ${focused ? "ring-accent/40" : ""}`}
      >
        <item.icon className="h-6 w-6" aria-hidden="true" />
        {/* focused underline glow 2px */}
        {focused && (
          <span className="absolute -bottom-1.5 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" aria-hidden="true" />
        )}
      </div>
      {/* running dots */}
      {running && (
        <div className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5" aria-hidden="true">
          {overflow ? (
            <span className="text-[9px] font-medium leading-none text-accent">+{count}</span>
          ) : (
            Array.from({ length: Math.min(count || minimizedCount, 3) }).map((_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" />
            ))
          )}
        </div>
      )}
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

  return (
    <>
      <div
        className="fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-end justify-center"
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
      >
        <div className="flex items-end gap-1 rounded-2xl border border-white/[0.08] bg-bg-elevated/95 px-2.5 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.06)_inset] backdrop-blur-xl">
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
          {/* divider */}
          <div className="mx-1 h-8 w-px self-center bg-white/10" aria-hidden="true" />
          {/* Trash static per wireframe */}
          <button
            aria-label="Trash"
            title="Trash"
            className="flex h-12 w-12 items-center justify-center rounded-[10px] bg-bg-overlay text-text-tertiary ring-1 ring-white/5 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FiTrash2 className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* context menu */}
      <AnimatePresence>
        {ctx && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            style={{ left: ctx.x, top: ctx.y - 80, willChange: "transform, opacity" } as React.CSSProperties}
            className="fixed z-[60] w-44 rounded-card border border-bg-hover bg-bg-overlay p-1 shadow-[0_16px_32px_rgba(0,0,0,0.4)]"
          >
            <button
              onClick={() => {
                // Show All = restore minimized + focus
                windows
                  .filter((w) => w.appId === ctx.appId && w.minimized)
                  .forEach((w) => restore(w.id));
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
                windows
                  .filter((w) => w.appId === ctx.appId)
                  .forEach((w) => useWindowStore.getState().close(w.id));
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
