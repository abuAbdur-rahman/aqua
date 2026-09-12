import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  copyPath,
  createDirectory,
  createFile,
  emptyTrash,
  listDirectory,
  listTrash,
  moveToTrash,
  permanentDelete,
  readFile,
  renameEntry,
  restoreFromTrash,
  writeFile,
} from "./filesystem";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("filesystem API", () => {
  it("lists an encoded directory path and validates entries", async () => {
    fetchMock.mockResolvedValue(response([
      {
        name: "README.md",
        path: "/home/dev/aqua/README.md",
        kind: "file",
        size: 42,
        modified: "2026-08-21T12:00:00Z",
        permissions: "644",
      },
    ]));

    await expect(listDirectory("/home/dev/my project")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:61234/api/fs/list?path=%2Fhome%2Fdev%2Fmy%20project",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects malformed daemon data", async () => {
    fetchMock.mockResolvedValue(response([{ name: "broken" }]));
    await expect(listDirectory(".")).rejects.toThrow("invalid filesystem entry");
  });

  it("reads a UTF-8 file", async () => {
    fetchMock.mockResolvedValue(response({
      path: "/home/dev/a.txt",
      content: "hello",
      encoding: "utf8",
      truncated: false,
    }));
    await expect(readFile("/home/dev/a.txt")).resolves.toMatchObject({ content: "hello" });
  });

  it("writes an existing file without creating it first", async () => {
    fetchMock.mockResolvedValue(response({ success: true, modified: "2026-08-21T12:00:00Z" }));
    await writeFile("/home/dev/a.txt", "changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: "/home/dev/a.txt",
      content: "changed",
    });
  });

  it("preserves conflict status for createFile", async () => {
    fetchMock.mockResolvedValue(response({ success: false, error: "File exists" }, 409));
    await expect(createFile("/home/dev/a.txt")).rejects.toMatchObject({
      status: 409,
      message: "File exists",
    });
  });

  it("sends contract-shaped directory operations", async () => {
    fetchMock.mockImplementation(async () => response({ success: true }));
    await createDirectory("/home/dev/new");
    await renameEntry("/home/dev/new", "renamed");
    await moveToTrash("/home/dev/renamed");

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { op: "createDir", path: "/home/dev/new" },
      { op: "rename", path: "/home/dev/new", newName: "renamed" },
      { op: "moveToTrash", path: "/home/dev/renamed" },
    ]);
  });

  it("returns the trashId when moveToTrash lands in the bucket", async () => {
    fetchMock.mockResolvedValue(response({ success: true, trashId: "tr_1" }));
    await expect(moveToTrash("/home/dev/a.txt")).resolves.toBe("tr_1");
  });

  it("resolves undefined when a Windows-mounted path is hard-deleted", async () => {
    fetchMock.mockResolvedValue(response({ success: true }));
    await expect(moveToTrash("/mnt/c/Users/dev/a.txt")).resolves.toBeUndefined();
  });

  it("sends contract-shaped trash and copy operations", async () => {
    fetchMock.mockImplementation(async () => response({ success: true }));
    await copyPath("/mnt/c/x.jpg", "/home/dev/pics");
    await restoreFromTrash("tr_1");
    await permanentDelete("tr_2");
    await emptyTrash();

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { op: "copy", path: "/mnt/c/x.jpg", to: "/home/dev/pics" },
      { op: "restoreFromTrash", trashId: "tr_1" },
      { op: "permanentDelete", trashId: "tr_2" },
      { op: "emptyTrash" },
    ]);
  });

  it("lists trash entries", async () => {
    fetchMock.mockResolvedValue(response([
      {
        id: "tr_1",
        originalPath: "/home/dev/a.txt",
        name: "a.txt",
        kind: "file",
        size: 12,
        deletedAt: "2026-08-25T10:00:00Z",
      },
    ]));
    await expect(listTrash()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:61234/api/trash/list",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("defaults missing isTrashable to false for older daemons", async () => {
    fetchMock.mockResolvedValue(response([
      {
        name: "README.md",
        path: "/home/dev/README.md",
        kind: "file",
        size: 42,
        modified: "2026-08-21T12:00:00Z",
        permissions: "644",
      },
    ]));
    const entries = await listDirectory(".");
    expect(entries[0]?.isTrashable).toBe(false);
  });

  it("surfaces HTTP failures with daemon error text", async () => {
    fetchMock.mockResolvedValue(response({ error: "path is outside the allowed root" }, 403));
    const error = await listDirectory("/tmp").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "path is outside the allowed root" });
  });
});
