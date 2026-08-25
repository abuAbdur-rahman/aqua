import { useWindowStore } from "../windows/store";
import { appManifest } from "../windows/manifest";
import { dispatchGalleryAction, useGalleryUiStore } from "../panes/gallery/galleryStore";
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

  const windowGroup: AppMenuGroup = {
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
  };

  // Gallery-specific groups per UI-SPEC-12 §8. Actions cross to the pane over
  // the shared CustomEvent channel; size/sort read the mirrored UI store.
  if (appId === "gallery") {
    const gallery = useGalleryUiStore.getState();
    return [
      {
        label: name,
        items: [
          {
            id: "about-gallery",
            label: "About Gallery",
            separatorAfter: true,
            onSelect: () => {}, // toast-free no-op until an About pane exists
          },
          {
            id: "quit",
            label: `Quit ${name}`,
            onSelect: () => appWindows.forEach((w) => store.close(w.id)),
          },
        ],
      },
      {
        label: "View",
        items: (["s", "m", "l"] as const).map((size) => ({
          id: `thumb-${size}`,
          label: `${size.toUpperCase()} Thumbnails`,
          enabled: gallery.thumbSize !== size,
          onSelect: () => gallery.setThumbSize(size),
        })),
      },
      {
        label: "Sort By",
        items: (
          [
            ["name", "Name"],
            ["modified", "Date Modified"],
            ["size", "Size"],
          ] as const
        ).map(([key, label]) => ({
          id: `sort-${key}`,
          label,
          enabled: gallery.sortBy !== key,
          onSelect: () => gallery.setSort(key, true),
        })),
      },
      {
        label: "Image",
        items: [
          {
            id: "image-rename",
            label: "Rename",
            enabled: gallery.hasSelection,
            onSelect: () => dispatchGalleryAction("rename"),
          },
          {
            id: "image-delete",
            label: "Move to Trash",
            enabled: gallery.hasSelection,
            onSelect: () => dispatchGalleryAction("delete"),
          },
          {
            id: "image-reveal",
            label: "Reveal in Finder",
            enabled: gallery.hasSelection,
            onSelect: () => dispatchGalleryAction("reveal"),
          },
          {
            id: "image-info",
            label: "Get Info",
            enabled: gallery.hasSelection,
            onSelect: () => dispatchGalleryAction("info"),
          },
        ],
      },
      windowGroup,
    ];
  }

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
    windowGroup,
  ];
}
