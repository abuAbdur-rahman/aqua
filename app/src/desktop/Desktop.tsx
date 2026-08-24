import { useEffect, useRef, useState } from "react";
import { MenuBar } from "./MenuBar";
import { Dock } from "./Dock";
import { MissionControl } from "./MissionControl";
import { WindowHost } from "../windows/WindowHost";
import { useDaemonConnection } from "../lib/useDaemon";
import { useWindowStore } from "../windows/store";
import { SpotlightPane } from "../panes/SpotlightPane";

export function Desktop() {
  const { state, version, wsConnected } = useDaemonConnection();
  const openEditor = useWindowStore((store) => store.openEditor);
  const openFinder = useWindowStore((store) => store.openFinder);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [missionControlOpen, setMissionControlOpen] = useState(false);
  const lastToggleRef = useRef(0);

  useEffect(() => {
    const onEditor = (event: Event) => openEditor((event as CustomEvent<string>).detail);
    const onFinder = (event: Event) => openFinder((event as CustomEvent<string>).detail);
    window.addEventListener("aqua:open-editor", onEditor);
    window.addEventListener("aqua:open-finder", onFinder);
    return () => {
      window.removeEventListener("aqua:open-editor", onEditor);
      window.removeEventListener("aqua:open-finder", onFinder);
    };
  }, [openEditor, openFinder]);

  useEffect(() => {
    // In Tauri the Rust host owns the global shortcut and emits `spotlight-toggle`;
    // attaching the JS fallback there too would double-toggle (open + instant close).
    const inTauri = "__TAURI_INTERNALS__" in window;
    let unlisten: (() => void) | undefined;
    // StrictMode mounts→unmounts→mounts in dev. If cleanup runs before the async
    // listen() resolves, the resolved listener must be removed immediately or it
    // leaks — a leaked duplicate makes every toggle fire twice (open + close).
    let disposed = false;

    if (inTauri) {
      void import("@tauri-apps/api/event")
        .then(({ listen }) => listen("spotlight-toggle", () => setSpotlightOpen((v) => !v)))
        .then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          unlisten = fn;
        })
        .catch(() => {});
    }

    const onKey = (e: KeyboardEvent) => {
      if (!inTauri && e.ctrlKey && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        const now = Date.now();
        if (now - lastToggleRef.current < 300) return;
        lastToggleRef.current = now;
        setSpotlightOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const onSpaceKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // Don't hijack word-jump/undo-style editing keys inside text fields.
      const target = e.target as HTMLElement | null;
      const inText =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest(".monaco-editor") != null);
      const store = useWindowStore.getState();
      if (e.key === "ArrowLeft" && !inText) {
        e.preventDefault();
        store.cycleSpace(-1);
      } else if (e.key === "ArrowRight" && !inText) {
        e.preventDefault();
        store.cycleSpace(1);
      } else if (e.key === "ArrowUp" && !inText) {
        e.preventDefault();
        setMissionControlOpen((v) => !v);
      } else if (/^[1-9]$/.test(e.key)) {
        const space = store.spaces[Number(e.key) - 1];
        if (space) {
          e.preventDefault();
          store.switchSpace(space.id);
        }
      }
    };
    window.addEventListener("keydown", onSpaceKey);
    return () => window.removeEventListener("keydown", onSpaceKey);
  }, []);

  return (
    <div className="fixed inset-0 m-0 p-0 bg-bg-base font-sans overflow-hidden select-none">
      <MenuBar daemonState={state} daemonVersion={version} wsConnected={wsConnected} />

      {/* Wallpaper behind everything, full bleed */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(1200px 600px at 75% -10%, rgba(34,211,238,0.08), transparent 60%), linear-gradient(180deg, var(--bg-base) 0%, #0d1a1e 85%, #0a1418 100%)`,
        }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")` }} aria-hidden="true" />

      {/* Window area explicitly reserved below MenuBar (24px) and above Dock (64px+16) */}
      <div className="absolute inset-x-0 top-6 bottom-[72px] overflow-hidden">
        <WindowHost />
      </div>

      <Dock />

      <SpotlightPane open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />

      <MissionControl open={missionControlOpen} onClose={() => setMissionControlOpen(false)} />
    </div>
  );
}
