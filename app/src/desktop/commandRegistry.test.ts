import { beforeEach, describe, expect, it } from "vitest";
import { useWindowStore } from "../windows/store";
import { buildCommands, groupCommands, matchesQuery } from "./commandRegistry";

const noop = () => {};

function build() {
  const store = useWindowStore.getState();
  return buildCommands({
    appId: store.focusedId != null ? (store.windows.find((w) => w.id === store.focusedId)?.appId ?? null) : null,
    focusedId: store.focusedId,
    onMissionControl: noop,
    onToggleSpotlight: noop,
    reportError: noop,
  });
}

  beforeEach(() => {
    useWindowStore.setState({
      windows: [],
      spaces: [{ id: 1, name: "Desktop 1" }],
      activeSpaceId: 1,
      nextZ: 10,
      focusedId: null,
      editorPathRequest: null,
      finderPathRequest: null,
      terminalPathRequest: null,
      galleryPathRequest: null,
      readerPathRequest: null,
    });
  });

describe("buildCommands", () => {
  it("orders groups app → window → space → system", () => {
    useWindowStore.getState().openApp("finder");
    const groups = groupCommands(build());
    expect(groups.map((g) => g.category)).toEqual(["app", "window", "space", "system"]);
  });

  it("with no focused window, window entries are disabled but present", () => {
    const entries = build();
    const minimize = entries.find((e) => e.id === "window.minimize");
    const close = entries.find((e) => e.id === "window.close");
    expect(minimize?.enabled).toBe(false);
    expect(close?.enabled).toBe(false);
  });

  it("with a focused window, window entries are enabled and app menus feed the app category", () => {
    useWindowStore.getState().openApp("gallery");
    const entries = build();
    expect(entries.find((e) => e.id === "window.minimize")?.enabled).toBe(true);
    // Gallery's own menu items land in the app category, not hardcoded in the palette
    expect(entries.some((e) => e.category === "app" && e.label === "Rename")).toBe(true);
    expect(entries.some((e) => e.category === "app" && e.label === "Move to Trash")).toBe(true);
  });

  it("a focused Reader window feeds its document actions into the app category", () => {
    useWindowStore.getState().openApp("reader");
    const entries = build();
    expect(entries.some((e) => e.category === "app" && e.label === "Copy as Markdown")).toBe(true);
    expect(entries.some((e) => e.category === "app" && e.label === "Toggle Table of Contents")).toBe(true);
  });

  it("does not duplicate the generic Window menu group into the app category", () => {
    useWindowStore.getState().openApp("finder");
    const appEntries = build().filter((e) => e.category === "app");
    expect(appEntries.some((e) => e.label === "Minimize")).toBe(false);
    expect(appEntries.some((e) => e.label === "Close Window")).toBe(false);
  });

  it("space switches exclude the active space; new space + mission control always enabled", () => {
    useWindowStore.getState().addSpace();
    let entries = build();
    expect(entries.find((e) => e.id === "space.switch.1")?.enabled).toBe(false);
    expect(entries.find((e) => e.id === "space.new")?.enabled).toBe(true);
    expect(entries.find((e) => e.id === "space.mission-control")?.enabled).toBe(true);

    useWindowStore.getState().switchSpace(2);
    entries = build();
    expect(entries.find((e) => e.id === "space.switch.1")?.enabled).toBe(true);
    expect(entries.find((e) => e.id === "space.switch.2")?.enabled).toBe(false);
  });

  it("move-to-space entries exist for non-current spaces only", () => {
    useWindowStore.getState().openApp("finder");
    useWindowStore.getState().openApp("terminal");
    useWindowStore.getState().addSpace();
    // Move the unfocused Finder so the focused Terminal keeps focus
    const finderId = useWindowStore.getState().windows.find((w) => w.appId === "finder")!.id;
    useWindowStore.getState().moveWindowToSpace(finderId, 2);
    const entries = build();
    // Focused Terminal lives in space 1, so targets are every other space
    expect(entries.find((e) => e.id === "window.move-to-space.1")).toBeUndefined();
    expect(entries.find((e) => e.id === "window.move-to-space.2")).toBeDefined();
  });

  it("system commands are present regardless of focus", () => {
    const ids = build().filter((e) => e.category === "system").map((e) => e.id);
    expect(ids).toContain("system.open-settings");
    expect(ids).toContain("system.toggle-spotlight");
    expect(ids).toContain("system.restart-daemon");
    expect(ids).toContain("system.restart-aqua");
    expect(ids).toContain("system.shut-down-aqua");
  });
});

describe("matchesQuery", () => {
  const entry = { id: "x", label: "Close Window", category: "window" as const, keywords: ["quit"] };

  it("empty query matches everything", () => {
    expect(matchesQuery(entry, "")).toBe(true);
    expect(matchesQuery(entry, "   ")).toBe(true);
  });

  it("matches subsequence across words", () => {
    expect(matchesQuery(entry, "clwin")).toBe(true);
    expect(matchesQuery(entry, "Close Window")).toBe(true);
  });

  it("rejects when characters are out of order or missing", () => {
    expect(matchesQuery(entry, "windcl")).toBe(false);
    expect(matchesQuery(entry, "close windows")).toBe(false);
  });

  it("falls back to keywords", () => {
    expect(matchesQuery(entry, "quit")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesQuery(entry, "CLOSE")).toBe(true);
  });
});

describe("groupCommands", () => {
  it("drops empty groups", () => {
    const groups = groupCommands([
      { id: "a", label: "A", category: "system", enabled: true, run: noop },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe("system");
    expect(groups[0].label).toBe("System");
  });
});
