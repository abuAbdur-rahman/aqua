import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";
import { useModalStore } from "../system/modalStore";

type DaemonState = "connecting" | "connected" | "failed";

interface SystemMenuProps {
  daemonState: DaemonState;
  daemonVersion: string | null;
}

interface MenuItem {
  id: string;
  label: string;
  onSelect?: () => void;
  enabled?: boolean;
  separatorAfter?: boolean;
}

async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return null;
  }
}

function Clock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className={`font-medium tabular-nums text-text-primary ${className ?? ""}`}>
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}

export function SystemMenu({ daemonState, daemonVersion }: SystemMenuProps) {
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const windows = useWindowStore((s) => s.windows);
  const [openPanel, setOpenPanel] = useState<"menu" | "about" | "forcequit" | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<{ appVersion: string | null; distro: string | null }>({
    appVersion: null,
    distro: null,
  });
  const navRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openPanel == null) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenPanel(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPanel(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onEsc);
    };
  }, [openPanel]);

  useEffect(() => {
    if (openPanel !== "about") return;
    let cancelled = false;
    void Promise.all([
      tauriInvoke<string>("plugin:app|version").then((v) => (typeof v === "string" ? v : null)),
      tauriInvoke<string>("get_distro"),
    ]).then(([appVersion, distro]) => {
      if (!cancelled) setAboutInfo({ appVersion, distro });
    });
    return () => {
      cancelled = true;
    };
  }, [openPanel]);

  useEffect(() => {
    if (!sleeping) return;
    const wake = () => setSleeping(false);
    window.addEventListener("keydown", wake);
    window.addEventListener("mousedown", wake);
    return () => {
      window.removeEventListener("keydown", wake);
      window.removeEventListener("mousedown", wake);
    };
  }, [sleeping]);

  useEffect(() => {
    if (openPanel === "menu") {
      dropdownRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
        ?.focus();
    }
  }, [openPanel]);

  const runningApps = useMemo(() => {
    const seen = new Map<string, string[]>();
    for (const w of windows) {
      const ids = seen.get(w.appId) ?? [];
      ids.push(w.id);
      seen.set(w.appId, ids);
    }
    return Array.from(seen.entries());
  }, [windows]);

  const confirmLifecycle = (title: string, body: string, danger: boolean, command: string) => {
    requestConfirm({
      title,
      body,
      confirmLabel: title.startsWith("Shut down") ? "Shut Down" : "Restart",
      danger,
      onConfirm: () => {
        void tauriInvoke(command);
      },
    });
  };

  const items: MenuItem[] = [
    { id: "about", label: "About Aqua", onSelect: () => setOpenPanel("about") },
    // Settings app arrives in Phase 10; the slot exists so the menu shape is final.
    { id: "settings", label: "Settings…", enabled: false },
    { id: "restart-daemon", separatorAfter: true, label: daemonState === "connected" ? "Restart Daemon" : "Start Daemon", onSelect: () => {
      setOpenPanel(null);
      if (daemonState === "connected") {
        confirmLifecycle(
          "Restart the daemon?",
          "Open terminal sessions will end.",
          true,
          "restart_daemon",
        );
      } else {
        void tauriInvoke("restart_daemon");
      }
    } },
    { id: "force-quit", label: "Force Quit…", onSelect: () => setOpenPanel("forcequit") },
    { id: "sleep", label: "Sleep Display", onSelect: () => { setOpenPanel(null); setSleeping(true); } },
    {
      id: "restart-aqua",
      label: "Restart Aqua",
      onSelect: () => {
        setOpenPanel(null);
        confirmLifecycle(
          "Restart Aqua?",
          "Every window closes and the desktop reloads.",
          false,
          "relaunch_aqua",
        );
      },
    },
    {
      id: "shutdown",
      label: "Shut Down Aqua",
      onSelect: () => {
        setOpenPanel(null);
        confirmLifecycle(
          "Shut down Aqua?",
          "This closes every window and stops the background daemon.",
          true,
          "quit_and_stop_daemon",
        );
      },
    },
  ];

  if (sleeping) {
    return (
      <div
        className="fixed inset-0 z-[2147483647] flex cursor-none items-center justify-center bg-bg-base/[0.97]"
        role="status"
        aria-label="Display asleep — press any key to wake"
      >
        <Clock className="text-5xl tracking-tight" />
      </div>
    );
  }

  return (
    <div ref={navRef} className="relative flex items-center">
      <button
        onClick={() => setOpenPanel(openPanel === "menu" ? null : "menu")}
        aria-haspopup="menu"
        aria-expanded={openPanel === "menu"}
        aria-label="Aqua system menu"
        className={`rounded px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${
          openPanel === "menu" ? "bg-bg-hover" : "hover:bg-bg-hover"
        }`}
      >
        {/* Fixed Aqua glyph — never changes with focus */}
        <span className="block h-2.5 w-2.5 rotate-45 rounded-[3px] bg-accent" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {openPanel === "menu" && (
          <motion.div
            ref={dropdownRef}
            role="menu"
            aria-label="System"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="absolute left-0 top-6 z-[2147483647] min-w-56 rounded-card border border-bg-hover bg-bg-overlay p-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            style={{ willChange: "transform, opacity" }}
            onKeyDown={(e) => {
              const items = Array.from(
                dropdownRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
              );
              const idx = items.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === "ArrowDown") {
                e.preventDefault();
                items[(idx + 1) % items.length]?.focus();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                items[(idx - 1 + items.length) % items.length]?.focus();
              }
            }}
          >
            {items.map((item) => (
              <div key={item.id} role="none">
                <button
                  role="menuitem"
                  disabled={item.enabled === false}
                  onClick={() => {
                    if (item.enabled === false) return;
                    item.onSelect?.();
                    if (item.id === "about" || item.id === "force-quit") return;
                    setOpenPanel(null);
                  }}
                  className={`flex w-full items-center rounded px-3 py-1.5 text-left text-xs ${
                    item.enabled === false
                      ? "cursor-default text-text-tertiary"
                      : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  {item.label}
                </button>
                {item.separatorAfter && <div className="my-1 h-px bg-white/10" aria-hidden="true" />}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openPanel === "about" && (
          <motion.div
            role="dialog"
            aria-label="About Aqua"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="absolute left-0 top-6 z-[2147483647] w-64 rounded-card border border-bg-hover bg-bg-overlay p-4 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            style={{ willChange: "transform, opacity" }}
          >
            <div className="flex items-start justify-between">
              <span className="block h-10 w-10 rotate-45 rounded-lg bg-accent" aria-hidden="true" />
              <button
                onClick={() => setOpenPanel(null)}
                aria-label="Close About Aqua"
                className="rounded p-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
              >
                ×
              </button>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-text-primary">Aqua</h3>
            <dl className="mt-2 space-y-1 text-[11px] text-text-secondary">
              <div className="flex justify-between gap-3">
                <dt>App version</dt>
                <dd className="tabular-nums">{aboutInfo.appVersion ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Daemon version</dt>
                <dd className="tabular-nums">{daemonVersion ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Distro</dt>
                <dd>{aboutInfo.distro ?? "—"}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {openPanel === "forcequit" && (
          <motion.div
            role="dialog"
            aria-label="Force Quit applications"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="absolute left-0 top-6 z-[2147483647] min-w-56 rounded-card border border-bg-hover bg-bg-overlay p-2 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            style={{ willChange: "transform, opacity" }}
          >
            {runningApps.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-text-tertiary">No open apps.</p>
            ) : (
              runningApps.map(([appId, windowIds]) => {
                const manifest = appManifest[appId];
                return (
                  <div key={appId} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-bg-hover">
                    <span className="flex min-w-0 items-center gap-2">
                      {manifest && <img src={manifest.icon} alt="" className="h-4 w-4 object-contain" aria-hidden="true" />}
                      <span className="truncate text-xs text-text-primary">{manifest?.name ?? appId}</span>
                    </span>
                    <button
                      onClick={() => {
                        const store = useWindowStore.getState();
                        windowIds.forEach((id) => store.close(id));
                        setOpenPanel(null);
                      }}
                      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-status-danger hover:bg-status-danger/15 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      Force Quit
                    </button>
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
