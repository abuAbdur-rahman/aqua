import { FiFolder, FiTerminal, FiCpu, FiCode, FiSearch } from "react-icons/fi";

interface DockItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  running?: boolean;
}

const DOCK_ITEMS: DockItem[] = [
  { id: "finder", label: "Finder", icon: FiFolder, running: false },
  { id: "terminal", label: "Terminal", icon: FiTerminal, running: false },
  { id: "editor", label: "Editor", icon: FiCode, running: false },
  { id: "activity", label: "Activity Monitor", icon: FiCpu, running: false },
  { id: "spotlight", label: "Spotlight", icon: FiSearch, running: false },
];

export function Dock() {
  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 h-[var(--height-dock)] min-w-[300px] bg-bg-elevated border-t border-bg-hover rounded-t-[var(--radius-window)] flex items-end justify-center pb-2 gap-3 z-50"
    >
      {DOCK_ITEMS.map((item) => (
        <button
          key={item.id}
          className="relative flex flex-col items-center p-2 rounded-[var(--radius-card)] transition-colors duration-100 hover:bg-bg-hover focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={item.label}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div
            className="relative w-[var(--size-dock-icon)] h-[var(--size-dock-icon)] flex items-center justify-center text-text-secondary"
          >
            <item.icon className="w-7 h-7" aria-hidden="true" />
            {item.running && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-accent" />
            )}
          </div>
          <span className="text-xs text-text-tertiary mt-1">{item.label}</span>
        </button>
      ))}
    </div>
  );
}