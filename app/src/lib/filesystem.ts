import { DAEMON_BASE } from "./api";

export type FsEntryKind = "file" | "dir" | "symlink";

export interface FsEntry {
  name: string;
  path: string;
  kind: FsEntryKind;
  size: number;
  modified: string;
  permissions: string;
}

export interface FsReadResponse {
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  truncated: boolean;
}

export type FsOp =
  | { op: "createFile"; path: string }
  | { op: "createDir"; path: string }
  | { op: "rename"; path: string; newName: string }
  | { op: "move"; path: string; to: string }
  | { op: "delete"; path: string }
  | { op: "chmod"; path: string; mode: string };

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
  return value as unknown as FsEntry;
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

async function runOperation(operation: FsOp): Promise<void> {
  const payload = await request("/api/fs/op", {
    method: "POST",
    body: JSON.stringify(operation),
  });
  if (!isRecord(payload) || payload.success !== true) {
    throw new Error("Daemon returned an invalid operation response");
  }
}

export function createFile(path: string) {
  return runOperation({ op: "createFile", path });
}

export function createDirectory(path: string) {
  return runOperation({ op: "createDir", path });
}

export function renameEntry(path: string, newName: string) {
  return runOperation({ op: "rename", path, newName });
}

export function deleteEntry(path: string) {
  return runOperation({ op: "delete", path });
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
