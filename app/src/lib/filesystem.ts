import { DAEMON_BASE } from "./api";

export type FsEntryKind = "file" | "dir" | "symlink";

export interface FsEntry {
  name: string;
  path: string;
  kind: FsEntryKind;
  size: number;
  modified: string;
  permissions: string;
  isTrashable: boolean;
}

export interface TrashEntry {
  id: string;
  originalPath: string;
  name: string;
  kind: FsEntryKind;
  size: number;
  deletedAt: string;
}

export interface FsReadResponse {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  truncated: boolean;
}

export type FsOp =
  | { op: "createFile"; path: string; elevated?: boolean }
  | { op: "createDir"; path: string; elevated?: boolean }
  | { op: "rename"; path: string; newName: string; elevated?: boolean }
  | { op: "move"; path: string; to: string; elevated?: boolean }
  | { op: "copy"; path: string; to: string; elevated?: boolean }
  | { op: "moveToTrash"; path: string; elevated?: boolean }
  | { op: "restoreFromTrash"; trashId: string; elevated?: boolean }
  | { op: "permanentDelete"; trashId: string; elevated?: boolean }
  | { op: "emptyTrash"; elevated?: boolean }
  | { op: "chmod"; path: string; mode: string; elevated?: boolean };

export class NeedsElevationError extends Error {
  constructor(
    message: string,
    readonly op: string,
    readonly path = "",
  ) {
    super(message);
    this.name = "NeedsElevationError";
  }
}

export type FsWatchEvent = {
  type: "change";
  path: string;
  kind: "created" | "modified" | "removed" | "renamed";
  entry?: FsEntry;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): FsEntry {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.path !== "string" ||
    !["file", "dir", "symlink"].includes(String(value.kind)) ||
    typeof value.size !== "number" ||
    typeof value.modified !== "string" ||
    typeof value.permissions !== "string"
  ) {
    throw new Error("Daemon returned an invalid filesystem entry");
  }
  // Older daemons predate isTrashable; absent means "not known to be
  // recoverable", which degrades to the previous hard-delete behavior.
  const entry = value as unknown as FsEntry;
  entry.isTrashable = value.isTrashable === true;
  return entry;
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(`${DAEMON_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : `${init.method} ${path} failed`;
    throw new ApiError(message, response.status);
  }
  return payload;
}

export async function listDirectory(path: string): Promise<FsEntry[]> {
  const payload = await request(`/api/fs/list?path=${encodeURIComponent(path)}`, { method: "GET" });
  if (!Array.isArray(payload)) throw new Error("Daemon returned an invalid directory listing");
  return payload.map(parseEntry);
}

export async function readFile(path: string): Promise<FsReadResponse> {
  const payload = await request(`/api/fs/read?path=${encodeURIComponent(path)}`, { method: "GET" });
  if (
    !isRecord(payload) ||
    typeof payload.path !== "string" ||
    typeof payload.content !== "string" ||
    !["utf8", "base64"].includes(String(payload.encoding)) ||
    typeof payload.truncated !== "boolean"
  ) {
    throw new Error("Daemon returned an invalid file response");
  }
  return payload as unknown as FsReadResponse;
}

async function runOperation(operation: FsOp): Promise<string | undefined> {
  const payload = await request("/api/fs/op", {
    method: "POST",
    body: JSON.stringify(operation),
  });
  if (typeof payload === "object" && payload !== null && (payload as Record<string, unknown>).success === false) {
    const body = payload as Record<string, unknown>;
    if (body.needsElevation === true) {
      throw new NeedsElevationError(
        typeof body.error === "string" ? body.error : "This operation requires elevation",
        operation.op,
        "path" in operation ? String(operation.path) : "",
      );
    }
    throw new Error(typeof body.error === "string" ? body.error : "Operation failed");
  }
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("Daemon returned an invalid operation response");
  }
  return payload.trashId === undefined ? undefined : String(payload.trashId);
}

export function createFile(path: string, elevated = false) {
  return runOperation(elevated ? { op: "createFile", path, elevated } : { op: "createFile", path });
}

export function createDirectory(path: string, elevated = false) {
  return runOperation(elevated ? { op: "createDir", path, elevated } : { op: "createDir", path });
}

export function renameEntry(path: string, newName: string, elevated = false) {
  return runOperation(
    elevated ? { op: "rename", path, newName, elevated } : { op: "rename", path, newName },
  );
}

// Resolves to the trashId when the item went to the Trash bucket, or undefined
// when the daemon hard-deleted it (Windows-mounted path — nothing recoverable).
export function moveToTrash(path: string, elevated = false): Promise<string | undefined> {
  return runOperation(elevated ? { op: "moveToTrash", path, elevated } : { op: "moveToTrash", path });
}

export function restoreFromTrash(trashId: string, elevated = false) {
  return runOperation(
    elevated ? { op: "restoreFromTrash", trashId, elevated } : { op: "restoreFromTrash", trashId },
  );
}

export function permanentDelete(trashId: string, elevated = false) {
  return runOperation(
    elevated ? { op: "permanentDelete", trashId, elevated } : { op: "permanentDelete", trashId },
  );
}

export function emptyTrash(elevated = false) {
  return runOperation(elevated ? { op: "emptyTrash", elevated } : { op: "emptyTrash" });
}

export function copyPath(path: string, to: string, elevated = false) {
  return runOperation(elevated ? { op: "copy", path, to, elevated } : { op: "copy", path, to });
}

export async function listTrash(): Promise<TrashEntry[]> {
  const payload = await request("/api/trash/list", { method: "GET" });
  if (!Array.isArray(payload)) throw new Error("Daemon returned an invalid trash listing");
  return payload.map((value: unknown): TrashEntry => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.originalPath !== "string" ||
      typeof value.name !== "string" ||
      !["file", "dir", "symlink"].includes(String(value.kind)) ||
      typeof value.size !== "number" ||
      typeof value.deletedAt !== "string"
    ) {
      throw new Error("Daemon returned an invalid trash entry");
    }
    return value as unknown as TrashEntry;
  });
}

export async function writeFile(path: string, content: string): Promise<string> {
  const payload = await request("/api/fs/write", {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
  if (!isRecord(payload) || payload.success !== true || typeof payload.modified !== "string") {
    throw new Error("Daemon returned an invalid write response");
  }
  return payload.modified;
}

export function parseFsWatchEvent(value: unknown): FsWatchEvent | null {
  if (
    !isRecord(value) ||
    value.type !== "change" ||
    typeof value.path !== "string" ||
    !["created", "modified", "removed", "renamed"].includes(String(value.kind))
  ) {
    return null;
  }
  try {
    return {
      type: "change",
      path: value.path,
      kind: value.kind as FsWatchEvent["kind"],
      ...(value.entry === undefined ? {} : { entry: parseEntry(value.entry) }),
    };
  } catch {
    return null;
  }
}
