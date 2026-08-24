export interface AppManifestEntry {
  id: string;
  name: string;
  icon: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  menus: string[];
}

export const appManifest: Record<string, AppManifestEntry> = {
  finder: {
    id: "finder",
    name: "Finder",
    icon: "/icons/icon-finder.svg",
    defaultSize: { w: 720, h: 480 },
    minSize: { w: 420, h: 300 },
    menus: ["File", "Edit", "View", "Go", "Window"],
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    icon: "/icons/icon-terminal.svg",
    defaultSize: { w: 680, h: 420 },
    minSize: { w: 400, h: 280 },
    menus: ["Shell", "Edit", "View", "Window"],
  },
  editor: {
    id: "editor",
    name: "Editor",
    icon: "/icons/icon-editor.svg",
    defaultSize: { w: 800, h: 520 },
    minSize: { w: 480, h: 320 },
    menus: ["File", "Edit", "Selection", "View", "Go"],
  },
  activity: {
    id: "activity",
    name: "Activity Monitor",
    icon: "/icons/icon-activity.svg",
    defaultSize: { w: 640, h: 460 },
    minSize: { w: 400, h: 300 },
    menus: ["View", "Window"],
  },
};
