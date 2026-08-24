import { useWindowStore } from "../windows/store";
import { appManifest } from "../windows/manifest";
import type { AppMenuGroup } from "./menuTypes";

// Builds the focused app's menu bar groups with real, working handlers.
// Menus are derived per focused window instance (not a shared static
// definition) so actions bind to the live window/store state.
export function buildAppMenus(appId: string, focusedId: string | null): AppMenuGroup[] {
  const store = useWindowStore.getState();
  const manifest = appManifest[appId];
  if (!manifest) return [];

  const name = manifest.name;
  const appWindows = store.windows.filter((w) => w.appId === appId);
  const minimizedOfApp = appWindows.filter((w) => w.minimized);

  return [
    {
      label: name,
      items: [
        {
          id: "quit",
          label: `Quit ${name}`,
          onSelect: () => appWindows.forEach((w) => store.close(w.id)),
        },
      ],
    },
    {
      label: "Window",
      items: [
        {
          id: "minimize",
          label: "Minimize",
          enabled: focusedId != null,
          onSelect: () => {
            if (focusedId) store.minimize(focusedId);
          },
        },
        {
          id: "close",
          label: "Close Window",
          enabled: focusedId != null,
          onSelect: () => {
            if (focusedId) store.close(focusedId);
          },
        },
        {
          id: "show-all",
          label: "Show All Windows",
          enabled: minimizedOfApp.length > 0,
          separatorAfter: true,
          onSelect: () => minimizedOfApp.forEach((w) => store.restore(w.id)),
        },
      ],
    },
  ];
}
