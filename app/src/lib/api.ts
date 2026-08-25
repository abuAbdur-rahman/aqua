export const DAEMON_BASE = "http://localhost:61234";

export interface HealthResponse {
  status: "ok";
  version: string;
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${DAEMON_BASE}/api/health`, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export function wsUrl(path: string): string {
  return `ws://localhost:61234${path}`;
}

export type ElevateResponse =
  | { success: true; expiresAt: string }
  | { success: false; error: string };

export function parseElevateResponse(value: unknown): ElevateResponse {
  if (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as Record<string, unknown>).success === "boolean"
  ) {
    const res = value as Record<string, unknown>;
    if (res.success === true && typeof res.expiresAt === "string") {
      return { success: true, expiresAt: res.expiresAt };
    }
    if (res.success === false && typeof res.error === "string") {
      return { success: false, error: res.error };
    }
  }
  throw new Error("Daemon returned an invalid elevation response");
}

export async function elevate(password: string): Promise<ElevateResponse> {
  const res = await fetch(`${DAEMON_BASE}/api/system/elevate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(15_000),
  });
  return parseElevateResponse(await res.json());
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DAEMON_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return res.json();
}

export interface CustomWallpaper {
  id: string;
  label: string;
  addedAt: string;
}

export interface WallpaperState {
  current: string;
  custom: CustomWallpaper[];
}

export function wallpaperAssetUrl(id: string, variant: "full" | "thumb"): string {
  return `${DAEMON_BASE}/api/wallpaper/asset/${encodeURIComponent(id)}${variant === "thumb" ? "/thumb" : ""}`;
}

export async function getWallpaper(): Promise<WallpaperState> {
  return fetchJson<WallpaperState>("/api/wallpaper");
}

export async function setWallpaper(id: string): Promise<void> {
  await fetchJson("/api/wallpaper", { method: "PUT", body: JSON.stringify({ id }) });
}

export async function uploadWallpaper(file: Blob, label: string): Promise<CustomWallpaper> {
  const res = await fetch(
    `${DAEMON_BASE}/api/wallpaper/upload?label=${encodeURIComponent(label)}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
      body: file,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const value = (await res.json()) as { success: true; wallpaper: CustomWallpaper } | { success: false; error: string };
  if (!value.success) throw new Error(value.error);
  return value.wallpaper;
}

export async function deleteWallpaper(id: string): Promise<void> {
  await fetchJson(`/api/wallpaper/${encodeURIComponent(id)}`, { method: "DELETE" });
}