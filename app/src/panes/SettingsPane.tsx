import { useState } from "react";
import { AppearancePane } from "./AppearancePane";
import { WallpaperPane } from "./WallpaperPane";
import { DaemonPane } from "./DaemonPane";
import { AboutPane } from "./AboutPane";
import { useDaemonConnection } from "../lib/useDaemon";

const SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "wallpaper", label: "Wallpaper" },
  { id: "daemon", label: "Daemon" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPane() {
  const [section, setSection] = useState<SectionId>("wallpaper");
  const { state, version } = useDaemonConnection();
  const connected = state === "connected";

  return (
    <div className="flex h-full">
      <nav aria-label="Settings sections" className="w-40 shrink-0 border-r border-bg-hover bg-bg-elevated p-2">
        <ul role="list">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  aria-current={active ? "page" : undefined}
                  className={`w-full rounded px-3 py-1.5 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${
                    active ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto p-5">
        {section === "appearance" && <AppearancePane />}
        {section === "wallpaper" && <WallpaperPane />}
        {section === "daemon" && <DaemonPane connected={connected} version={version} />}
        {section === "about" && <AboutPane />}
      </div>
    </div>
  );
}
