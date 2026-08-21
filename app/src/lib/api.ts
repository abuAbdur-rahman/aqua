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

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${DAEMON_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  return res.json();
}