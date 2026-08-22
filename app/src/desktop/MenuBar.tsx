import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FiMonitor } from "react-icons/fi";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";

interface MenuBarProps {
  daemonState: "connecting" | "connected" | "failed";
  daemonVersion: string | null;
  wsConnected: boolean;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="text-[12px] font-medium tabular-nums text-text-primary">
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

export function MenuBar({ daemonState, daemonVersion, wsConnected }: MenuBarProps) {
  const focusedWindow = useWindowStore((s) => {
    const fw = s.windows.find((w) => w.focused && !w.minimized);
    return fw ?? null;
  });
  const focusedApp = focusedWindow ? appManifest[focusedWindow.appId] : null;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const dotRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (daemonState === "connected") setLastSeen(new Date());
  }, [daemonState]);

  // Close popover on outside click / Esc
  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dotRef.current && !dotRef.current.contains(e.target as Node)) {
        const pop = document.getElementById("daemon-popover");
        if (pop && !pop.contains(e.target as Node)) setPopoverOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [popoverOpen]);

  const dotState =
    daemonState === "connected"
      ? { color: "bg-status-success", label: null as string | null, tooltip: "Aqua daemon connected", pulse: false }
      : daemonState === "connecting"
        ? { color: "bg-status-warning", label: null, tooltip: "Reconnecting to daemon…", pulse: true }
        : { color: "bg-status-danger", label: "Daemon offline", tooltip: "Daemon offline", pulse: false };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex h-6 items-center gap-3 border-b border-white/[0.06] bg-bg-elevated px-3 select-none"
      role="menubar"
      aria-label="Aqua menu bar"
    >
      {/* Left cluster: focused app icon+name + menus */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          {focusedApp ? (
            <img src={focusedApp.icon} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />
          ) : (
            <FiMonitor className="h-4 w-4 text-text-primary" aria-hidden="true" />
          )}
          <span className="text-[13px] font-semibold tracking-tight text-text-primary">
            {focusedApp ? focusedApp.name : "Aqua"}
          </span>
        </span>
        {focusedApp && focusedApp.menus.length > 0 && (
          <nav className="hidden items-center gap-0.5 sm:flex" aria-label={`${focusedApp.name} menus`}>
            {focusedApp.menus.map((m) => (
              <button
                key={m}
                className="rounded px-1.5 py-0.5 text-[12px] font-medium leading-none text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              >
                {m}
              </button>
            ))}
          </nav>
        )}
        {daemonVersion && (
          <span className="hidden rounded bg-bg-hover px-1.5 py-0.5 text-[11px] font-medium leading-none text-text-tertiary sm:inline">
            v{daemonVersion}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Right cluster: per-app indicator slot + global dot + clock */}
      <div className="flex items-center gap-3">
        {/* Slot for per-app quick indicator (e.g. Activity CPU% when that app focused) — reserved */}
        <div className="relative flex items-center gap-2">
          <button
            ref={dotRef}
            onClick={() => {
              if (daemonState === "failed") setPopoverOpen((v) => !v);
            }}
            aria-label={dotState.tooltip}
            aria-expanded={popoverOpen}
            title={dotState.tooltip}
            className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="relative inline-flex h-2 w-2">
              <span className={`h-2 w-2 rounded-full ${dotState.color}`} aria-hidden="true" />
              {dotState.pulse && (
                <motion.span
                  aria-hidden="true"
                  className={`absolute inset-0 rounded-full ${dotState.color}`}
                  animate={{ opacity: [0.9, 0.35, 0.9], scale: [1, 1.5, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  style={{ willChange: "transform, opacity" }}
                />
              )}
              {daemonState === "connected" && wsConnected && (
                <span className="absolute inset-0 rounded-full shadow-[0_0_6px_var(--status-success)]" aria-hidden="true" />
              )}
            </span>
            {dotState.label && <span className="text-xs font-medium text-status-danger">{dotState.label}</span>}
          </button>

          <AnimatePresence>
            {popoverOpen && daemonState === "failed" && (
              <motion.div
                id="daemon-popover"
                role="dialog"
                aria-label="Daemon connection"
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
                className="absolute right-0 top-7 z-50 w-72 rounded-card border border-bg-hover bg-bg-overlay p-3 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
                style={{ willChange: "transform, opacity" }}
              >
                <p className="text-xs font-medium text-text-primary">Daemon offline</p>
                {lastSeen && (
                  <p className="mt-1 text-[11px] text-text-tertiary">Last seen {lastSeen.toLocaleTimeString()}</p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setRetryCount((c) => c + 1);
                      window.location.reload();
                    }}
                    className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Retry now
                  </button>
                  <button
                    onClick={() => setPopoverOpen(false)}
                    className="rounded-card border border-bg-hover bg-bg-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Dismiss
                  </button>
                </div>
                {retryCount >= 3 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
                    Still failing — check whether the WSL daemon process is running (`cargo run` in `daemon/`), then retry.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <Clock />
      </div>
    </div>
  );
}
