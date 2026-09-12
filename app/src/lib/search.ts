import { fetchJson } from "./api";

export interface SearchFileHit {
  path: string;
  name: string;
  snippet?: string;
  score: number;
}

export interface SearchAppHit {
  id: string;
  name: string;
  icon: string;
}

export interface SearchActionHit {
  kind: "calculator" | "unitConvert";
  input: string;
  result: string;
}

export interface SearchResponse {
  files: SearchFileHit[];
  apps: SearchAppHit[];
  actions: SearchActionHit[];
}

export type SpotlightItem =
  | { kind: "app"; hit: SearchAppHit }
  | { kind: "file"; hit: SearchFileHit }
  | { kind: "action"; hit: SearchActionHit };

export const SEARCH_DEBOUNCE_MS = 175;

export function search(query: string): Promise<SearchResponse> {
  return fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
}

export function flattenResults(res: SearchResponse): SpotlightItem[] {
  return [
    ...res.apps.map((hit) => ({ kind: "app", hit }) as SpotlightItem),
    ...res.files.map((hit) => ({ kind: "file", hit }) as SpotlightItem),
    ...res.actions.map((hit) => ({ kind: "action", hit }) as SpotlightItem),
  ];
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}
