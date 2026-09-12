import { useEffect, useRef, useState } from "react";
import { readFile } from "../../lib/filesystem";
import { base64ToBlob, mimeForExtension } from "./galleryUtils";

const MAX_CACHED = 150;
const MAX_CONCURRENT_READS = 6;

export interface ThumbnailState {
  status: "idle" | "queued" | "loading" | "loaded" | "error";
  url: string | null;
  error?: string;
}

interface CacheApi {
  /** Bumped on every cache mutation so consumers re-read via `get`. */
  version: number;
  get(path: string): ThumbnailState;
  /** Queue a lazy load (grid cells). Priority jobs jump the FIFO queue. */
  request(path: string, priority?: boolean): void;
  /** Drop a queued or in-flight job for a cell that scrolled out. */
  cancel(path: string): void;
  /** Revoke and forget a cached image (fs-watch "modified"). */
  evict(path: string): void;
}

const IDLE: ThumbnailState = { status: "idle", url: null };

export function useThumbnailCache(): CacheApi {
  const entriesRef = useRef(new Map<string, ThumbnailState>());
  const queueRef = useRef<string[]>([]);
  const activeRef = useRef(0);
  const cancelledRef = useRef(new Set<string>());
  const pumpRef = useRef<() => void>(() => {});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // Final teardown only — per-eviction revocation happens in evict/trim;
    // URLs stay alive across component re-renders by design.
    const entries = entriesRef.current;
    return () => {
      for (const entry of entries.values()) {
        if (entry.url) URL.revokeObjectURL(entry.url);
      }
      entries.clear();
    };
  }, []);

  const bump = () => setVersion((value) => value + 1);

  const trim = () => {
    const entries = entriesRef.current;
    while (entries.size > MAX_CACHED) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      const entry = entries.get(oldest.value);
      if (entry?.url) URL.revokeObjectURL(entry.url);
      entries.delete(oldest.value);
    }
  };

  const runNext = (path: string) => {
    activeRef.current += 1;
    entriesRef.current.set(path, { status: "loading", url: null });
    bump();
    void readFile(path)
      .then((result) => {
        if (cancelledRef.current.has(path)) return;
        if (result.truncated) {
          entriesRef.current.set(path, {
            status: "error",
            url: null,
            error: "File too large to preview",
          });
          return;
        }
        // SVG (and any text-decoded image) arrives as utf8; raster formats as base64.
        const blob =
          result.encoding === "base64"
            ? base64ToBlob(result.content, mimeForExtension(path))
            : new Blob([new TextEncoder().encode(result.content)], { type: mimeForExtension(path) });
        entriesRef.current.set(path, { status: "loaded", url: URL.createObjectURL(blob) });
        trim();
      })
      .catch((cause: unknown) => {
        if (cancelledRef.current.has(path)) return;
        entriesRef.current.set(path, {
          status: "error",
          url: null,
          error: cause instanceof Error ? cause.message : "Couldn't load this image",
        });
      })
      .finally(() => {
        cancelledRef.current.delete(path);
        activeRef.current -= 1;
        bump();
        pumpRef.current();
      });
  };

  const pump = () => {
    while (activeRef.current < MAX_CONCURRENT_READS && queueRef.current.length > 0) {
      const path = queueRef.current.shift();
      if (path === undefined) break;
      if (cancelledRef.current.has(path)) {
        cancelledRef.current.delete(path);
        continue;
      }
      runNext(path);
    }
  };
  pumpRef.current = pump;

  return {
    version,
    get: (path) => entriesRef.current.get(path) ?? IDLE,
    request: (path, priority = false) => {
      const existing = entriesRef.current.get(path);
      if (existing && existing.status !== "idle" && existing.status !== "error") return;
      if (existing?.status === "error") {
        // A retry re-enters the pipeline; clear the terminal state first.
        if (queueRef.current.includes(path) || cancelledRef.current.has(path)) return;
      }
      entriesRef.current.set(path, { status: "queued", url: null });
      if (priority) queueRef.current.unshift(path);
      else queueRef.current.push(path);
      bump();
      pump();
    },
    cancel: (path) => {
      const queuedIndex = queueRef.current.indexOf(path);
      if (queuedIndex !== -1) {
        queueRef.current.splice(queuedIndex, 1);
        entriesRef.current.set(path, IDLE);
        bump();
        return;
      }
      const existing = entriesRef.current.get(path);
      if (existing?.status === "loading") cancelledRef.current.add(path);
    },
    evict: (path) => {
      const queuedIndex = queueRef.current.indexOf(path);
      if (queuedIndex !== -1) queueRef.current.splice(queuedIndex, 1);
      if (entriesRef.current.get(path)?.status === "loading") cancelledRef.current.add(path);
      const entry = entriesRef.current.get(path);
      if (entry?.url) URL.revokeObjectURL(entry.url);
      if (entriesRef.current.delete(path)) bump();
    },
  };
}
