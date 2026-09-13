import { useState } from "react";
import { AppearancePane } from "./AppearancePane";
import { WallpaperPane } from "./WallpaperPane";
import { DaemonPane } from "./DaemonPane";
import { UpdatePane } from "./UpdatePane";
import { AboutPane } from "./AboutPane";
import { GeneralPane } from "./GeneralPane";
import { HotkeysPane } from "./HotkeysPane";
import { useDaemonConnection } from "../lib/useDaemon";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "wallpaper", label: "Wallpaper" },
  { id: "daemon", label: "Daemon" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function SettingsPane() {
  const [section, setSection] = useState<SectionId>("wallpaper");
  const { state, version } = useDaemonConnection();
  const connected = state === "connected";

  return (
    <div className="flex h-full">
      <nav aria-label="Settings sections" className="w-[200px] shrink-0 border-r border-bg-hover bg-bg-elevated p-2">
        <ul role="list">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <li key={s.id}>
                <button
                  onClick={() => setSection(s.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative h-10 w-full rounded px-3 py-1.5 pl-3 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${
                    active ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                  }`}
                >
                  {active && <span className="absolute left-0 top-0 h-full w-[3px] rounded bg-accent" aria-hidden="true" />}
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto p-6">
        {section === "general" && <GeneralPane />}
        {section === "appearance" && <AppearancePane />}
        {section === "wallpaper" && <WallpaperPane />}
        {section === "daemon" && <DaemonPane connected={connected} version={version} />}
        {section === "hotkeys" && <HotkeysPane />}
        {section === "updates" && <UpdatePane />}
        {section === "about" && <AboutPane />}
      </div>
    </div>
  );
}
