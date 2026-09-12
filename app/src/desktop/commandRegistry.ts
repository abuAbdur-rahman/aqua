import { buildAppMenus } from "./menus";
import type { AppMenuGroup } from "./menuTypes";
import { useWindowStore } from "../windows/store";

export type CommandCategory = "app" | "window" | "space" | "system";

export interface CommandEntry {
  id: string;
  label: string;
  category: CommandCategory;
  keywords?: string[];
  shortcutHint?: string;
  enabled: boolean;
  run: () => void;
}

export interface CommandGroup {
  category: CommandCategory;
  label: string;
  entries: CommandEntry[];
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  app: "Application",
  window: "Window",
  space: "Spaces",
  system: "System",
};

const GROUP_ORDER: CommandCategory[] = ["app", "window", "space", "system"];

function tauriAvailable(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

async function tauriInvoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(cmd);
}

// Flattens AppMenuGroups into entries, skipping the generic "Window" group —
// those actions come from the dedicated window source below so a command is
// defined exactly once (UI-SPEC-14 §3).
function entriesFromMenus(groups: AppMenuGroup[]): CommandEntry[] {
  const out: CommandEntry[] = [];
  for (const group of groups) {
    if (group.label === "Window") continue;
    for (const item of group.items) {
      out.push({
        id: `app.${group.label}.${item.id}`,
        label: item.label,
        category: "app",
        shortcutHint: item.shortcut,
        enabled: item.enabled !== false,
        run: () => item.onSelect(),
      });
    }
  }
  return out;
}

function windowEntries(): CommandEntry[] {
  const store = useWindowStore.getState();
  const focusedId = store.focusedId;
  const focused = focusedId != null ? store.windows.find((w) => w.id === focusedId) : undefined;
  const hasFocused = focused != null;

  const moveToSpace: CommandEntry[] = store.spaces
    .filter((sp) => sp.id !== focused?.spaceId)
    .map((sp) => ({
      id: `window.move-to-space.${sp.id}`,
      label: `Move to ${sp.name}`,
      category: "window" as const,
      enabled: hasFocused && !focused.minimized,
      run: () => {
        if (focusedId) useWindowStore.getState().moveWindowToSpace(focusedId, sp.id);
      },
    }));

  return [
    {
      id: "window.minimize",
      label: "Minimize",
      category: "window",
      enabled: hasFocused && !focused.minimized,
      run: () => {
        if (focusedId) useWindowStore.getState().minimize(focusedId);
      },
    },
    {
      id: "window.zoom",
      label: focused?.maximized ? "Zoom (Restore)" : "Zoom (Fullscreen)",
      category: "window",
      keywords: ["maximize", "restore"],
      enabled: hasFocused && !focused.minimized,
      run: () => {
        if (focusedId)
          useWindowStore
            .getState()
            .toggleMaximize(focusedId, { w: window.innerWidth, h: window.innerHeight });
      },
    },
    ...moveToSpace,
    {
      id: "window.close",
      label: "Close Window",
      category: "window",
      enabled: hasFocused,
      run: () => {
        if (focusedId) useWindowStore.getState().close(focusedId);
      },
    },
  ];
}

function spaceEntries(onMissionControl: () => void): CommandEntry[] {
  const store = useWindowStore.getState();
  const switches: CommandEntry[] = store.spaces.map((sp) => ({
    id: `space.switch.${sp.id}`,
    label: `Switch to ${sp.name}`,
    category: "space",
    enabled: sp.id !== store.activeSpaceId,
    run: () => useWindowStore.getState().switchSpace(sp.id),
  }));
  return [
    ...switches,
    {
      id: "space.new",
      label: "New Space",
      category: "space",
      keywords: ["add", "create", "desktop"],
      enabled: true,
      run: () => useWindowStore.getState().addSpace(),
    },
    {
      id: "space.mission-control",
      label: "Open Mission Control",
      category: "space",
      shortcutHint: "Ctrl+↑",
      keywords: ["spaces", "overview", "expose"],
      enabled: true,
      run: onMissionControl,
    },
  ];
}

function systemEntries(
  onToggleSpotlight: () => void,
  reportError: (id: string, message: string) => void,
): CommandEntry[] {

  const invokeSafe = (id: string, cmd: string) => () => {
    if (!tauriAvailable()) {
      reportError(id, "Only available inside the Aqua app");
      return;
    }
    tauriInvoke(cmd).catch((err: unknown) =>
      reportError(id, err instanceof Error ? err.message : String(err)),
    );
  };

  return [
    {
      id: "system.open-settings",
      label: "Open Settings",
      category: "system",
      keywords: ["preferences"],
      enabled: true,
      run: () => useWindowStore.getState().openApp("settings"),
    },
    {
      id: "system.toggle-spotlight",
      label: "Toggle Spotlight",
      category: "system",
      keywords: ["search"],
      enabled: true,
      run: onToggleSpotlight,
    },
    {
      id: "system.restart-daemon",
      label: "Restart Daemon",
      category: "system",
      keywords: ["backend", "wsl"],
      enabled: tauriAvailable(),
      run: invokeSafe("system.restart-daemon", "restart_daemon"),
    },
    {
      id: "system.restart-aqua",
      label: "Restart Aqua",
      category: "system",
      keywords: ["reboot", "app"],
      enabled: tauriAvailable(),
      run: invokeSafe("system.restart-aqua", "relaunch_aqua"),
    },
    {
      id: "system.shut-down-aqua",
      label: "Shut Down Aqua",
      category: "system",
      keywords: ["quit", "stop daemon"],
      enabled: tauriAvailable(),
      run: invokeSafe("system.shut-down-aqua", "quit_and_stop_daemon"),
    },
  ];
}

export function buildCommands(options: {
  appId: string | null;
  focusedId: string | null;
  onMissionControl: () => void;
  onToggleSpotlight: () => void;
  reportError: (id: string, message: string) => void;
}): CommandEntry[] {
  const menus =
    options.appId != null ? buildAppMenus(options.appId, options.focusedId) : [];
  return [
    ...entriesFromMenus(menus),
    ...windowEntries(),
    ...spaceEntries(options.onMissionControl),
    ...systemEntries(options.onToggleSpotlight, options.reportError),
  ];
}

export function groupCommands(entries: CommandEntry[]): CommandGroup[] {
  return GROUP_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    entries: entries.filter((e) => e.category === category),
  })).filter((g) => g.entries.length > 0);
}

// Subsequence fuzzy match against label + keywords: every query character
// must appear in order somewhere in the haystack.
export function matchesQuery(
  entry: Pick<CommandEntry, "label" | "keywords">,
  rawQuery: string,
): boolean {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const haystacks = [entry.label.toLowerCase(), ...(entry.keywords ?? []).map((k) => k.toLowerCase())];
  return haystacks.some((haystack) => {
    let qi = 0;
    for (let hi = 0; hi < haystack.length && qi < query.length; hi++) {
      if (haystack[hi] === query[qi]) qi += 1;
    }
    return qi === query.length;
  });
}
