import type { IconType } from "react-icons";
import { FiFolder, FiTerminal, FiCpu, FiCode, FiSearch } from "react-icons/fi";

export interface AppManifestEntry {
  id: string;
  name: string;
  icon: IconType;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  dockHideDot?: boolean;
}

export const appManifest: Record<string, AppManifestEntry> = {
  finder: {
    id: "finder",
    name: "Finder",
    icon: FiFolder,
    defaultSize: { w: 720, h: 480 },
    minSize: { w: 420, h: 300 },
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    icon: FiTerminal,
    defaultSize: { w: 680, h: 420 },
    minSize: { w: 400, h: 280 },
  },
  editor: {
    id: "editor",
    name: "Editor",
    icon: FiCode,
    defaultSize: { w: 800, h: 520 },
    minSize: { w: 480, h: 320 },
  },
  activity: {
    id: "activity",
    name: "Activity Monitor",
    icon: FiCpu,
    defaultSize: { w: 640, h: 460 },
    minSize: { w: 400, h: 300 },
  },
  spotlight: {
    id: "spotlight",
    name: "Spotlight",
    icon: FiSearch,
    defaultSize: { w: 560, h: 320 },
    minSize: { w: 360, h: 240 },
    dockHideDot: true,
  },
};
