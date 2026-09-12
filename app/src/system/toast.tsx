import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { FiAlertCircle, FiInfo, FiX } from "react-icons/fi";
import type { ReactNode } from "react";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, ttl?: number) => Toast;
  dismiss: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, number>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, ttl = 4000): Toast => {
    const id = nextId++;
    const item: Toast = { id, kind, message };
    set((s) => ({ toasts: [...s.toasts, item] }));
    const timer = window.setTimeout(() => get().dismiss(id), ttl);
    timers.set(id, timer);
    return item;
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

// Convenience helpers so callers don't reach into the store directly.
export const toast = {
  success: (message: string) => useToastStore.getState().push("success", message),
  error: (message: string) => useToastStore.getState().push("error", message),
  info: (message: string) => useToastStore.getState().push("info", message),
};

const ICONS: Record<ToastKind, ReactNode> = {
  success: <img src="/icons/aqua-logo.png" alt="" className="h-5 w-5 rounded" />,
  error: <FiAlertCircle className="h-5 w-5 text-status-danger" aria-hidden="true" />,
  info: <FiInfo className="h-5 w-5 text-accent" aria-hidden="true" />,
};

// Mounted once at the desktop root. Every pane routes feedback here so errors
// and successes surface consistently instead of living in per-pane snippets.
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[2147483646] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            role={t.kind === "error" ? "alert" : "status"}
            aria-live={t.kind === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-bg-surface/95 p-3 shadow-lg backdrop-blur ${
              t.kind === "error" ? "border-status-danger/40" : "border-bg-hover"
            }`}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
            <p className="flex-1 text-xs leading-snug text-text-primary">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              <FiX className="h-4 w-4" aria-hidden="true" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
