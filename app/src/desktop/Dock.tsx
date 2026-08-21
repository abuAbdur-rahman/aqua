import { FiFolder, FiTerminal, FiCpu, FiCode, FiSearch } from "react-icons/fi";
import { useWindowStore } from "../windows/store";
import { appManifest } from "../windows/manifest";

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

export function Dock() {
  const windows = useWindowStore((s) => s.windows);
  const openApp = useWindowStore((s) => s.openApp);
  const restore = useWindowStore((s) => s.restore);

  const isRunning = (appId: string) => windows.some((w) => w.appId === appId && !w.minimized);
  const isMinimized = (appId: string) => windows.some((w) => w.appId === appId && w.minimized);

  return (
    <div className="fixed bottom-2 left-1/2 z-50 flex -translate-x-1/2 items-end justify-center">
      <div className="flex items-end gap-1 rounded-2xl border border-bg-hover bg-bg-elevated/95 px-2.5 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.45),0_1px_0_rgba(255,255,255,0.06)_inset] backdrop-blur-xl h-16">
        {DOCK_ORDER.map((item) => {
          const running = isRunning(item.id);
          const minimized = isMinimized(item.id);
          const manifest = appManifest[item.id];
          return (
            <button
              key={item.id}
              onClick={() => {
                if (minimized) {
                  const win = windows.find((w) => w.appId === item.id && w.minimized);
                  if (win) restore(win.id);
                } else {
                  openApp(item.id);
                }
              }}
              aria-label={`${item.label}${running ? " (running)" : ""}${minimized ? " (minimized)" : ""}`}
              title={item.label}
              className="group relative flex flex-col items-center rounded-card p-1.5 transition-colors duration-120 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
              <div className="relative flex h-12 w-12 items-center justify-center rounded-[10px] bg-bg-overlay text-text-secondary ring-1 ring-white/5 transition-all duration-120 group-hover:scale-[1.04] group-active:scale-[0.97] group-hover:text-text-primary">
                <item.icon className="h-6 w-6" aria-hidden="true" />
                {!manifest?.dockHideDot && running && (
                  <span className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" aria-hidden="true" />
                )}
                {minimized && !running && (
                  <span className="absolute -bottom-1 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-text-tertiary" aria-hidden="true" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
