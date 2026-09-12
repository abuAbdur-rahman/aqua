import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiPlus } from "react-icons/fi";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";

function WindowCard({ winId, onPick }: { winId: string; onPick: (id: string) => void }) {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === winId));
  if (!win) return null;
  const manifest = appManifest[win.appId];
  // Scaled chrome mock — a live DOM clone would be too heavy for an overview.
  const scale = 180 / Math.max(win.w, 1);
  const previewH = Math.min(win.h * scale, 120);

  return (
    <motion.button
      layout
      draggable
      onDragStart={(e) => {
        (e as unknown as React.DragEvent).dataTransfer?.setData("text/aqua-window", win.id);
      }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }}
      onClick={() => onPick(win.id)}
      aria-label={win.title}
      className="group w-[200px] cursor-grab overflow-hidden rounded-window border border-bg-hover bg-bg-surface text-left shadow-[0_12px_32px_rgba(0,0,0,0.45)] transition-colors hover:border-accent/40 focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
    >
      <div className="flex h-6 items-center gap-1.5 border-b border-bg-hover bg-bg-elevated px-2">
        {manifest && <img src={manifest.icon} alt="" className="h-3 w-3 object-contain" aria-hidden="true" />}
        <span className="truncate text-[10px] text-text-secondary">{win.title}</span>
      </div>
      <div className="flex items-center justify-center bg-bg-base/60" style={{ height: previewH }}>
        <div
          className="rounded-window border border-bg-hover bg-bg-surface"
          style={{ width: win.w * scale * 0.8, height: Math.max(win.h * scale * 0.8, 12) }}
          aria-hidden="true"
        />
      </div>
    </motion.button>
  );
}

export function MissionControl({ open, onClose }: { open: boolean; onClose: () => void }) {
  const windows = useWindowStore((s) => s.windows);
  const spaces = useWindowStore((s) => s.spaces);
  const activeSpaceId = useWindowStore((s) => s.activeSpaceId);
  const switchSpace = useWindowStore((s) => s.switchSpace);
  const addSpace = useWindowStore((s) => s.addSpace);
  const removeSpace = useWindowStore((s) => s.removeSpace);
  const moveWindowToSpace = useWindowStore((s) => s.moveWindowToSpace);
  const [dragOverSpace, setDragOverSpace] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const activeWindows = windows.filter((w) => w.spaceId === activeSpaceId);

  const pick = (id: string) => {
    const win = windows.find((w) => w.id === id);
    if (win) switchSpace(win.spaceId);
    useWindowStore.getState().focus(id);
    onClose();
  };

  return (
    <motion.div
      role="dialog"
      aria-label="Mission Control"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }}
      className="fixed inset-0 z-[60] bg-bg-base/85 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full flex-col items-center gap-6 px-8 pb-24 pt-10">
        {/* Spaces strip */}
        <div className="flex items-start gap-3" role="tablist" aria-label="Spaces">
          {spaces.map((sp) => {
            const spWindows = windows.filter((w) => w.spaceId === sp.id);
            const active = sp.id === activeSpaceId;
            return (
              <div
                key={sp.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={() => switchSpace(sp.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    switchSpace(sp.id);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverSpace(sp.id);
                }}
                onDragLeave={() => setDragOverSpace((s) => (s === sp.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverSpace(null);
                  const id = e.dataTransfer.getData("text/aqua-window");
                  if (id) moveWindowToSpace(id, sp.id);
                }}
                className={`group relative w-40 cursor-pointer rounded-card border p-2 transition-colors ${
                  active ? "border-accent/60 bg-accent-bg" : dragOverSpace === sp.id ? "border-accent/40 bg-bg-hover" : "border-bg-hover bg-bg-elevated/70 hover:bg-bg-hover"
                }`}
              >
                {spaces.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSpace(sp.id);
                    }}
                    aria-label={`Delete ${sp.name}`}
                    title={`Delete ${sp.name}`}
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-bg-overlay text-[9px] leading-none text-text-tertiary ring-1 ring-white/10 transition-colors hover:bg-status-danger hover:text-text-primary group-hover:flex focus-visible:flex focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    ×
                  </button>
                )}
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={`text-[10px] font-medium ${active ? "text-text-primary" : "text-text-tertiary"}`}>{sp.name}</span>
                  <span className="text-[10px] text-text-tertiary">{spWindows.length}</span>
                </div>
                <div className="flex h-16 flex-wrap content-start gap-1 overflow-hidden rounded bg-bg-base/70 p-1">
                  {spWindows.slice(0, 6).map((w) => (
                    <div key={w.id} className="h-4 w-6 rounded-sm border border-bg-hover bg-bg-surface" title={w.title} />
                  ))}
                </div>
              </div>
            );
          })}
          <button
            onClick={addSpace}
            aria-label="Add desktop"
            className="flex h-[104px] w-16 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-bg-hover text-text-tertiary transition-colors hover:border-accent/40 hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FiPlus className="h-4 w-4" aria-hidden="true" />
            <span className="text-[10px]">Add</span>
          </button>
        </div>

        {/* Windows of the active space */}
        <div className="flex max-w-[900px] flex-wrap items-start justify-center gap-4">
          <AnimatePresence>
            {activeWindows.map((w) => (
              <WindowCard key={w.id} winId={w.id} onPick={pick} />
            ))}
          </AnimatePresence>
          {activeWindows.length === 0 && (
            <p className="mt-16 text-xs text-text-tertiary">No windows on this desktop</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
