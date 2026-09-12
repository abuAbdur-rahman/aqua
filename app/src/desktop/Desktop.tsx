import { useEffect, useRef, useState } from "react";
import { MenuBar } from "./MenuBar";
import { Dock } from "./Dock";
import { MissionControl } from "./MissionControl";
import { WindowHost } from "../windows/WindowHost";
import { useDaemonConnection } from "../lib/useDaemon";
import { useWindowStore } from "../windows/store";
import { useLayoutPersistence } from "../lib/useLayoutPersistence";
import { SpotlightPane } from "../panes/SpotlightPane";
import { CommandCenter } from "./CommandCenter";
import { ModalHost } from "../system/ModalHost";
import { ToastHost } from "../system/toast";
import { Wallpaper } from "./Wallpaper";
import { WidgetGallery, WidgetToolbar } from "./widgets/WidgetGallery";
import { WidgetLayer } from "./widgets/WidgetLayer";
import { useWidgetStore } from "./widgets/widgetStore";

export function Desktop() {
  const { state, version, wsConnected } = useDaemonConnection();
  const openEditor = useWindowStore((store) => store.openEditor);
  const openFinder = useWindowStore((store) => store.openFinder);
  const openTerminal = useWindowStore((store) => store.openTerminal);
  const openGallery = useWindowStore((store) => store.openGallery);
  const openReader = useWindowStore((store) => store.openReader);
  const openApp = useWindowStore((store) => store.openApp);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [missionControlOpen, setMissionControlOpen] = useState(false);
  const [widgetCatalogOpen, setWidgetCatalogOpen] = useState(false);
  const editMode = useWidgetStore((s) => s.editMode);
  const setEditMode = useWidgetStore((s) => s.setEditMode);
  const projectsNotice = useWidgetStore((s) => s.projectsNotice);
  const lastToggleRef = useRef(0);

  useLayoutPersistence(state === "connected");

  // The terminal's `aqua` shell function raises these events (see
  // lib/aquaCommands). Path-taking apps forward the detail; path-less ones
  // just launch.
  useEffect(() => {
    const listen = (name: string, handler: (detail: string) => void) => {
      const onEvent = (event: Event) => handler((event as CustomEvent<string>).detail);
      window.addEventListener(name, onEvent);
      return () => window.removeEventListener(name, onEvent);
    };
    const cleanups = [
      listen("aqua:open-editor", openEditor),
      listen("aqua:open-finder", openFinder),
      listen("aqua:open-terminal", openTerminal),
      listen("aqua:open-gallery", openGallery),
      listen("aqua:open-reader", openReader),
      listen("aqua:open-activity", () => openApp("activity")),
      listen("aqua:open-settings", () => openApp("settings")),
      listen("aqua:open-trash", () => openApp("trash")),
    ];
    return () => cleanups.forEach((dispose) => dispose());
  }, [openApp, openEditor, openFinder, openGallery, openReader, openTerminal]);

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
    const onOpenSpotlight = () => setSpotlightOpen(true);
    window.addEventListener("aqua:open-spotlight", onOpenSpotlight);
    return () => window.removeEventListener("aqua:open-spotlight", onOpenSpotlight);
  }, []);

  useEffect(() => {
    // Command Center trigger: Ctrl+Shift+/, local to the WebView (UI-SPEC-14 §2
    // — no Tauri global shortcut). Skips text fields so Monaco's block-comment
    // binding and form input aren't hijacked, matching the Spaces handler below.
    const onCommandKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;
      if (e.code !== "Slash") return;
      const target = e.target as HTMLElement | null;
      const inText =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest(".monaco-editor") != null);
      if (inText) return;
      e.preventDefault();
      setCommandCenterOpen((v) => !v);
    };
    window.addEventListener("keydown", onCommandKey);
    return () => window.removeEventListener("keydown", onCommandKey);
  }, []);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-app-window]")) return;
      if (target.closest("[data-desktop-surface]")) {
        // Keep the original Spotlight surface, but expose widget editing as a
        // real desktop context affordance. A dedicated menu would be nicer —
        // for now a simple confirm keeps it discoverable without new UI.
        if (event.shiftKey) {
          const next = !useWidgetStore.getState().editMode;
          setEditMode(next);
          if (!next) setWidgetCatalogOpen(false);
          return;
        }
        window.dispatchEvent(new CustomEvent("aqua:open-spotlight"));
      }
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, [setEditMode]);

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
      <Wallpaper daemonConnected={state === "connected"} />
      <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")` }} aria-hidden="true" />

      {/* Widgets sit above wallpaper, below windows (UI-SPEC-17 §1) */}
      <div className="absolute inset-x-0 top-6 bottom-[72px] overflow-hidden" data-desktop-surface>
        <WidgetLayer />
        <WindowHost />
      </div>

      {editMode && (
        <>
          <WidgetToolbar
            catalogOpen={widgetCatalogOpen}
            onToggleCatalog={() => setWidgetCatalogOpen((v) => !v)}
            onDone={() => {
              setEditMode(false);
              setWidgetCatalogOpen(false);
            }}
          />
          {widgetCatalogOpen && (
            <>
              <div className="fixed inset-0 z-20" onPointerDown={() => setWidgetCatalogOpen(false)} />
              <WidgetGallery onClose={() => setWidgetCatalogOpen(false)} />
            </>
          )}
        </>
      )}
      {projectsNotice && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded bg-bg-elevated px-3 py-2 text-xs text-text-secondary shadow">
          {projectsNotice} <button className="ml-2 text-accent" onClick={() => useWidgetStore.setState({ projectsNotice: null })}>Dismiss</button>
        </div>
      )}

      <Dock />

      <SpotlightPane open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />

      <CommandCenter
        open={commandCenterOpen}
        onClose={() => setCommandCenterOpen(false)}
        onOpenMissionControl={() => {
          setCommandCenterOpen(false);
          setMissionControlOpen(true);
        }}
        onToggleSpotlight={() => {
          setCommandCenterOpen(false);
          setSpotlightOpen((v) => !v);
        }}
      />

      <MissionControl open={missionControlOpen} onClose={() => setMissionControlOpen(false)} />

      <ModalHost />
      <ToastHost />
    </div>
  );
}
