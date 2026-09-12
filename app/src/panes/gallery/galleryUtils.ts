import type { FsEntry } from "../../lib/filesystem";

export const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;
export const LARGE_FILE_BYTES = 8 * 1024 * 1024;

export type ThumbSize = "s" | "m" | "l";
export type ImageSortKey = "name" | "modified" | "size";

/** Tile body size in px per thumbnail setting (S/M/L per UI-SPEC-12 §3). */
export const THUMB_TILE: Record<ThumbSize, number> = { s: 104, m: 148, l: 204 };
export const GRID_GAP = 8;
export const LABEL_H = 22;
export const GRID_PADDING = 12;

export function isImageFile(entry: FsEntry): boolean {
  return entry.kind === "file" && IMAGE_EXTENSIONS.test(entry.name);
}

export function mimeForExtension(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

export function sortImages(images: FsEntry[], key: ImageSortKey, ascending: boolean): FsEntry[] {
  return [...images].sort((left, right) => {
    const comparison =
      key === "size"
        ? left.size - right.size
        : key === "modified"
          ? left.modified.localeCompare(right.modified)
          : left.name.localeCompare(right.name);
    return ascending ? comparison : -comparison;
  });
}

export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function describeEntry(entry: FsEntry): string {
  return `${entry.name} — ${formatSize(entry.size)} · modified ${formatDate(entry.modified)} · ${entry.permissions}`;
}

export function parentOf(path: string): string {
  if (path === ".") return ".";
  if (path === "/") return "/";
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export interface Crumb {
  label: string;
  path: string;
}

export function breadcrumbs(path: string): Crumb[] {
  if (path === ".") return [{ label: "Home", path: "." }];
  const parts = path.replace(/^\.\//, "").split("/").filter(Boolean);
  const stem = path.startsWith("/") ? path.replace(/^\.\//, "") : path;
  return [
    { label: "Home", path: "." },
    ...parts.map((part, index) => ({
      label: part,
      path: stem.startsWith("/")
        ? `/${parts.slice(0, index + 1).join("/")}`
        : `./${parts.slice(0, index + 1).join("/")}`,
    })),
  ];
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
