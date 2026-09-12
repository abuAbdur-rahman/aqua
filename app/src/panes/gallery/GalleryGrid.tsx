import { useEffect, useRef, useState } from "react";
import type { FsEntry } from "../../lib/filesystem";
import {
  GRID_GAP,
  GRID_PADDING,
  LABEL_H,
  LARGE_FILE_BYTES,
  THUMB_TILE,
  type ThumbSize,
} from "./galleryUtils";
import type { ThumbnailState } from "./useThumbnailCache";

interface GalleryGridProps {
  images: FsEntry[];
  thumbSize: ThumbSize;
  selected: ReadonlySet<string>;
  primaryPath: string | null;
  getThumb: (path: string) => ThumbnailState;
  onRequestThumb: (path: string) => void;
  onSelect: (path: string, event: React.MouseEvent) => void;
  onOpen: (path: string) => void;
  onContextMenu: (event: React.MouseEvent, path: string) => void;
  /** Selection moved by keyboard — grid scrolls it into view. */
  scrollTargetPath: string | null;
}

/**
 * Windowed grid: renders only the rows intersecting the viewport plus one
 * buffer row above/below (UI-SPEC-12 §3/§5). Visible-cell bookkeeping doubles
 * as the lazy-load trigger — same outcome as a per-cell IntersectionObserver
 * without wiring an observer per node.
 */
export function GalleryGrid({
  images,
  thumbSize,
  selected,
  primaryPath,
  getThumb,
  onRequestThumb,
  onSelect,
  onOpen,
  onContextMenu,
  scrollTargetPath,
}: GalleryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const rafRef = useRef<number | null>(null);

  const tile = THUMB_TILE[thumbSize];
  const rowHeight = tile + LABEL_H;
  const columns = Math.max(1, Math.floor((viewport.width - GRID_PADDING * 2 + GRID_GAP) / (tile + GRID_GAP)));
  const totalRows = Math.ceil(images.length / columns);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([measure]) => {
      if (!measure) return;
      setViewport({ width: measure.contentRect.width, height: measure.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 1);
  const lastRow = Math.min(totalRows, Math.ceil((scrollTop + viewport.height) / rowHeight) + 1);
  const visible = images.slice(firstRow * columns, lastRow * columns);

  // Lazy-load every visible, ungated cell that hasn't started loading yet.
  useEffect(() => {
    for (const image of visible) {
      if (image.size > LARGE_FILE_BYTES) continue;
      const state = getThumb(image.path);
      if (state.status === "idle") onRequestThumb(image.path);
    }
  });

  useEffect(() => {
    if (!scrollTargetPath) return;
    const cell = containerRef.current?.querySelector<HTMLDivElement>(
      `[data-gallery-cell="${CSS.escape(scrollTargetPath)}"]`,
    );
    cell?.scrollIntoView({ block: "nearest" });
  }, [scrollTargetPath]);

  const onScroll = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(containerRef.current?.scrollTop ?? 0);
    });
  };

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const renderThumb = (image: FsEntry) => {
    const state = getThumb(image.path);
    if (state.status === "loaded" && state.url) {
      return (
        <img src={state.url} alt={image.name} loading="lazy" decoding="async" className="h-full w-full rounded-md object-cover" />
      );
    }
    if (image.size > LARGE_FILE_BYTES && (state.status === "idle" || state.status === "queued")) {
      return (
        <button
          className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md bg-bg-elevated text-text-tertiary hover:text-text-secondary"
          aria-label={`Load preview of ${image.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRequestThumb(image.path);
          }}
        >
          <span className="text-lg" aria-hidden="true">🖼</span>
          <span className="px-1 text-[9px] leading-tight">Large file — click to load</span>
        </button>
      );
    }
    if (state.status === "error") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-md bg-bg-elevated text-status-danger" title={state.error}>
          <span className="text-xl" aria-hidden="true">⚠</span>
          <span className="px-1 text-center text-[9px] leading-tight">Couldn't load</span>
        </div>
      );
    }
    return (
      <div
        className={`h-full w-full animate-pulse rounded-md bg-bg-elevated ${state.status === "idle" ? "opacity-60" : ""}`}
        aria-hidden="true"
      />
    );
  };

  return (
    <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto p-3" role="grid" aria-label="Images">
      <div className="relative" style={{ height: totalRows * rowHeight }}>
        {visible.map((image, sliceIndex) => {
          const index = firstRow * columns + sliceIndex;
          const row = Math.floor(index / columns);
          const column = index % columns;
          const isSelected = selected.has(image.path);
          return (
            <div
              key={image.path}
              data-gallery-cell={image.path}
              role="gridcell"
              aria-selected={isSelected}
              tabIndex={-1}
              onClick={(event) => onSelect(image.path, event)}
              onDoubleClick={() => onOpen(image.path)}
              onContextMenu={(event) => onContextMenu(event, image.path)}
              className={`absolute cursor-pointer select-none rounded-card border p-1.5 ${isSelected ? "border-accent/60 bg-accent-bg" : "border-transparent hover:border-bg-hover hover:bg-bg-hover/40"} ${primaryPath === image.path ? "ring-2 ring-accent/50" : ""}`}
              style={{ left: column * (tile + GRID_GAP), top: row * rowHeight, width: tile, height: rowHeight }}
            >
              <div style={{ width: tile - 14, height: tile - 16 }} className="overflow-hidden rounded-md bg-bg-surface">
                {renderThumb(image)}
              </div>
              <div className="mt-0.5 truncate px-0.5 text-[10px] leading-[16px] text-text-secondary" title={image.name}>
                {image.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
