import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenResults, parentDir, search, SEARCH_DEBOUNCE_MS } from "./search";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("search", () => {
  it("queries the encoded term against /api/search", async () => {
    fetchMock.mockResolvedValue(response({ files: [], apps: [], actions: [] }));

    await expect(search("fs mod")).resolves.toEqual({ files: [], apps: [], actions: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:61234/api/search?q=fs%20mod",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("rejects on non-ok responses", async () => {
    fetchMock.mockResolvedValue(response({}, 500));
    await expect(search("x")).rejects.toThrow("500");
  });
});

describe("flattenResults", () => {
  it("orders groups apps → files → actions", () => {
    const items = flattenResults({
      files: [{ path: "/a/b.txt", name: "b.txt", score: 1 }],
      apps: [{ id: "terminal", name: "Terminal", icon: "" }],
      actions: [{ kind: "calculator", input: "42 * 12", result: "504" }],
    });

    expect(items.map((i) => i.kind)).toEqual(["app", "file", "action"]);
    expect(items[0]).toEqual({ kind: "app", hit: { id: "terminal", name: "Terminal", icon: "" } });
    expect(items[2]).toEqual({ kind: "action", hit: { kind: "calculator", input: "42 * 12", result: "504" } });
  });

  it("handles an all-empty response", () => {
    expect(flattenResults({ files: [], apps: [], actions: [] })).toHaveLength(0);
  });
});

describe("parentDir", () => {
  it("returns the parent directory of a file path", () => {
    expect(parentDir("/home/dev/aqua/README.md")).toBe("/home/dev/aqua");
  });

  it("falls back to root for top-level paths", () => {
    expect(parentDir("/README.md")).toBe("/");
  });
});

describe("SEARCH_DEBOUNCE_MS", () => {
  it("stays inside the spec's 150–200ms window", () => {
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(150);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(200);
  });
});
