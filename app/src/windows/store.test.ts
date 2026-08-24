import { beforeEach, describe, expect, it } from "vitest";
import { useWindowStore } from "./store";

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
  });
});

describe("spaces", () => {
  it("opens new windows into the active space", () => {
    useWindowStore.getState().addSpace();
    useWindowStore.getState().switchSpace(2);
    useWindowStore.getState().openApp("finder");

    const win = useWindowStore.getState().windows[0];
    expect(win.spaceId).toBe(2);
    expect(useWindowStore.getState().activeSpaceId).toBe(2);
  });

  it("switching space focuses the top window of that space", () => {
    useWindowStore.getState().openApp("finder");
    useWindowStore.getState().openApp("terminal");
    useWindowStore.getState().addSpace();
    useWindowStore.getState().moveWindowToSpace(
      useWindowStore.getState().windows[0].id,
      2,
    );
    useWindowStore.getState().switchSpace(2);

    const s = useWindowStore.getState();
    expect(s.activeSpaceId).toBe(2);
    expect(s.focusedId).toBe(s.windows[0].id);
  });

  it("cycleSpace wraps in both directions", () => {
    useWindowStore.getState().addSpace();
    useWindowStore.getState().addSpace();

    useWindowStore.getState().cycleSpace(1);
    expect(useWindowStore.getState().activeSpaceId).toBe(2);
    useWindowStore.getState().cycleSpace(1);
    expect(useWindowStore.getState().activeSpaceId).toBe(3);
    useWindowStore.getState().cycleSpace(1);
    expect(useWindowStore.getState().activeSpaceId).toBe(1);
    useWindowStore.getState().cycleSpace(-1);
    expect(useWindowStore.getState().activeSpaceId).toBe(3);
  });

  it("moveWindowToSpace migrates and focuses on arrival", () => {
    useWindowStore.getState().openApp("finder");
    const winId = useWindowStore.getState().windows[0].id;
    useWindowStore.getState().addSpace();
    useWindowStore.getState().moveWindowToSpace(winId, 2);

    let s = useWindowStore.getState();
    expect(s.windows.find((w) => w.id === winId)?.spaceId).toBe(2);
    // window left space 1 — nothing focused there
    expect(s.focusedId).toBe(null);

    useWindowStore.getState().moveWindowToSpace(winId, 1);
    s = useWindowStore.getState();
    expect(s.windows.find((w) => w.id === winId)?.spaceId).toBe(1);
    expect(s.focusedId).toBe(winId);
  });

  it("moveWindowToSpace ignores unknown spaces and same-space moves", () => {
    useWindowStore.getState().openApp("finder");
    const winId = useWindowStore.getState().windows[0].id;
    const zBefore = useWindowStore.getState().windows[0].z;

    useWindowStore.getState().moveWindowToSpace(winId, 99);
    useWindowStore.getState().moveWindowToSpace(winId, 1);

    const win = useWindowStore.getState().windows.find((w) => w.id === winId);
    expect(win?.spaceId).toBe(1);
    expect(win?.z).toBe(zBefore);
  });

  it("closing a window focuses the next window in the same space", () => {
    useWindowStore.getState().openApp("finder");
    useWindowStore.getState().openApp("terminal");
    const s = useWindowStore.getState();
    const finder = s.windows.find((w) => w.appId === "finder");
    const terminal = s.windows.find((w) => w.appId === "terminal");
    useWindowStore.getState().close(terminal!.id);

    expect(useWindowStore.getState().focusedId).toBe(finder!.id);
  });
});

describe("removeSpace", () => {
  it("refuses to remove the last space", () => {
    useWindowStore.getState().removeSpace(1);
    expect(useWindowStore.getState().spaces).toHaveLength(1);
  });

  it("reassigns windows to the next space to the right", () => {
    useWindowStore.getState().openApp("finder");
    const winId = useWindowStore.getState().windows[0].id;
    useWindowStore.getState().addSpace();
    useWindowStore.getState().removeSpace(1);

    const s = useWindowStore.getState();
    expect(s.spaces.map((sp) => sp.id)).toEqual([2]);
    expect(s.windows.find((w) => w.id === winId)?.spaceId).toBe(2);
  });

  it("reassigns windows to the previous space when removing the rightmost", () => {
    useWindowStore.getState().addSpace();
    useWindowStore.getState().switchSpace(2);
    useWindowStore.getState().openApp("finder");
    const winId = useWindowStore.getState().windows[0].id;
    useWindowStore.getState().removeSpace(2);

    const s = useWindowStore.getState();
    expect(s.spaces.map((sp) => sp.id)).toEqual([1]);
    expect(s.windows.find((w) => w.id === winId)?.spaceId).toBe(1);
  });

  it("removing the active space lands on the destination with focus", () => {
    useWindowStore.getState().addSpace();
    useWindowStore.getState().switchSpace(2);
    useWindowStore.getState().openApp("terminal");
    const termId = useWindowStore.getState().windows[0].id;
    useWindowStore.getState().removeSpace(2);

    const s = useWindowStore.getState();
    expect(s.activeSpaceId).toBe(1);
    expect(s.focusedId).toBe(termId);
    expect(s.windows.find((w) => w.id === termId)?.focused).toBe(true);
  });

  it("removing an inactive space keeps the active space and its focus", () => {
    useWindowStore.getState().openApp("finder");
    const finderId = useWindowStore.getState().windows[0].id;
    useWindowStore.getState().addSpace();
    useWindowStore.getState().removeSpace(2);

    const s = useWindowStore.getState();
    expect(s.activeSpaceId).toBe(1);
    expect(s.focusedId).toBe(finderId);
  });

  it("ignores unknown space ids", () => {
    useWindowStore.getState().removeSpace(99);
    expect(useWindowStore.getState().spaces).toHaveLength(1);
  });
});
