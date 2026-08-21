import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createDirectory,
  createFile,
  deleteEntry,
  listDirectory,
  readFile,
  renameEntry,
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
    await deleteEntry("/home/dev/renamed");

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
      { op: "createDir", path: "/home/dev/new" },
      { op: "rename", path: "/home/dev/new", newName: "renamed" },
      { op: "delete", path: "/home/dev/renamed" },
    ]);
  });

  it("surfaces HTTP failures with daemon error text", async () => {
    fetchMock.mockResolvedValue(response({ error: "path is outside the allowed root" }, 403));
    const error = await listDirectory("/tmp").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, message: "path is outside the allowed root" });
  });
});
