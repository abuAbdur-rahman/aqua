import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiArrowLeft, FiArrowUp, FiChevronDown, FiImage, FiRefreshCw } from "react-icons/fi";
import {
  ApiError,
  deleteEntry,
  listDirectory,
  NeedsElevationError,
  renameEntry,
  type FsEntry,
} from "../../lib/filesystem";
import { useFsWatch } from "../../lib/useFsWatch";
import { useModalStore } from "../../system/modalStore";
import { toast } from "../../system/toast";
import { useWindowStore } from "../../windows/store";
import { GalleryGrid } from "./GalleryGrid";
import { Loupe } from "./Loupe";
import { useGalleryUiStore, type GalleryMenuAction } from "./galleryStore";
import {
  breadcrumbs,
  describeEntry,
  isImageFile,
  parentOf,
  sortImages,
  type ImageSortKey,
} from "./galleryUtils";
import { useThumbnailCache, type ThumbnailState } from "./useThumbnailCache";

type LoadState = "loading" | "empty" | "populated" | "error";

const HOME_PATH = ".";

const SORT_LABELS: Record<ImageSortKey, string> = {
  name: "Name",
  modified: "Date Modified",
  size: "Size",
};

export function GalleryPane() {
  const [path, setPath] = useState(HOME_PATH);
  const [images, setImages] = useState<FsEntry[]>([]);
  const [otherCount, setOtherCount] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [primaryPath, setPrimaryPath] = useState<string | null>(null);
  const [loupeIndex, setLoupeIndex] = useState<number | null>(null);
  const [scrollTargetPath, setScrollTargetPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FsEntry } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const cache = useThumbnailCache();
  const thumbSize = useGalleryUiStore((s) => s.thumbSize);
  const sortBy = useGalleryUiStore((s) => s.sortBy);
  const sortAscending = useGalleryUiStore((s) => s.sortAscending);
  const setThumbSize = useGalleryUiStore((s) => s.setThumbSize);
  const setSort = useGalleryUiStore((s) => s.setSort);
  const setHasSelectionFlag = useGalleryUiStore((s) => s.setHasSelection);

  const openFinder = useWindowStore((state) => state.openFinder);
  const galleryPathRequest = useWindowStore((state) => state.galleryPathRequest);
  const clearGalleryPathRequest = useWindowStore((state) => state.clearGalleryPathRequest);
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const requestPrompt = useModalStore((s) => s.requestPrompt);
  const requestElevate = useModalStore((s) => s.requestElevate);

  const sortedImages = useMemo(() => sortImages(images, sortBy, sortAscending), [images, sortBy, sortAscending]);
  const primary = primaryPath ? sortedImages.find((image) => image.path === primaryPath) ?? null : null;

  // ---- loading -------------------------------------------------------------

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage(null);
    try {
      const entries = await listDirectory(path);
      const matched = entries.filter(isImageFile);
      setImages(matched);
      setOtherCount(entries.length - matched.length);
      setLoadState(matched.length === 0 ? "empty" : "populated");
      const surviving = new Set(matched.map((image) => image.path));
      setSelectedPaths((current) => new Set([...current].filter((p) => surviving.has(p))));
      setPrimaryPath((current) =>
        current && surviving.has(current) ? current : null,
      );
      setLoupeIndex(null);
    } catch (cause: unknown) {
      setLoadState("error");
      setErrorMessage(cause instanceof Error ? cause.message : "Unable to read this folder");
    }
  }, [path]);

  // Single source of truth for the menu bar's enabled flag.
  useEffect(() => {
    setHasSelectionFlag(selectedPaths.size > 0);
  }, [selectedPaths, setHasSelectionFlag]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (galleryPathRequest) {
      setPath(galleryPathRequest);
      clearGalleryPathRequest();
    }
  }, [clearGalleryPathRequest, galleryPathRequest]);

  // ---- fs-watch live updates (UI-SPEC-12 §7) --------------------------------

  const reloadRef = useRef(load);
  reloadRef.current = load;
  const evictRef = useRef(cache.evict);
  evictRef.current = cache.evict;

  const onWatchEvent = useCallback(
    (event: import("../../lib/filesystem").FsWatchEvent) => {
      // Same home-path guard as Finder: "." isn't a real watch target, so the
      // watched directory is derived from the first listing entry.
      if (parentOf(event.path) !== path && path !== HOME_PATH) return;

      if (event.kind === "created") {
        void reloadRef.current();
        return;
      }
      if (event.kind === "modified") {
        evictRef.current(event.path);
        setImages((current) =>
          current.map((image) => (image.path === event.path ? { ...image, modified: new Date().toISOString() } : image)),
        );
        return;
      }
      if (event.kind === "removed") {
        evictRef.current(event.path);
        const index = images.findIndex((image) => image.path === event.path);
        if (index === -1) return;
        const next = images.filter((image) => image.path !== event.path);
        setImages(next);
        setSelectedPaths((current) => {
          const nextSelection = new Set(current);
          nextSelection.delete(event.path);
          return nextSelection;
        });
        setPrimaryPath((currentPrimary) => (currentPrimary === event.path ? null : currentPrimary));
        setLoupeIndex((currentLoupe) => {
          if (currentLoupe === null) return null;
          if (next.length === 0) return null;
          // Auto-advance past the removed item so the viewer stays usable.
          return Math.min(currentLoupe > index ? currentLoupe - 1 : currentLoupe, next.length - 1);
        });
        return;
      }
      // renamed — the event carries no old name, so an in-place patch can't be
      // keyed reliably; a re-list produces the same result without guessing.
      if (event.kind === "renamed") void reloadRef.current();
    },
    [path, images],
  );

  useFsWatch(path, onWatchEvent);

  // Keep the Loupe's full-size image in sync with its (possibly shifted) entry.
  useEffect(() => {
    if (loupeIndex === null) return;
    const image = sortedImages[loupeIndex];
    if (!image) return;
    cache.request(image.path, true);
  }, [loupeIndex, sortedImages, cache]);

  // ---- selection & actions --------------------------------------------------

  const select = (targetPath: string, event: React.MouseEvent) => {
    const target = sortedImages.find((image) => image.path === targetPath);
    if (!target) return;
    setScrollTargetPath(null);
    if (event.shiftKey && anchorPath) {
      const anchorIndex = sortedImages.findIndex((image) => image.path === anchorPath);
      const targetIndex = sortedImages.findIndex((image) => image.path === target.path);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const range = sortedImages.slice(start, end + 1).map((image) => image.path);
        setSelectedPaths(new Set(range));
        setHasSelectionFlag(true);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.has(target.path)) next.delete(target.path);
        else next.add(target.path);
        return next;
      });
      setAnchorPath(target.path);
      setPrimaryPath(target.path);
      return;
    }
    setSelectedPaths(new Set([target.path]));
    setAnchorPath(target.path);
    setPrimaryPath(target.path);
  };

  const handleNeedsElevation = (cause: unknown, detail: string, retry: () => Promise<void>, fallback: string): boolean => {
    if (!(cause instanceof NeedsElevationError)) return false;
    requestElevate({
      appName: "Gallery",
      detail: `${detail} requires your password.`,
      onSuccess: () => {
        void retry().catch((retryCause: unknown) =>
          toast.error(retryCause instanceof Error ? retryCause.message : fallback),
        );
      },
    });
    return true;
  };

  const renameEntryByPath = (targetPath: string) => {
    const target = images.find((image) => image.path === targetPath);
    if (!target) return;
    requestPrompt({
      title: "Rename",
      label: "New name",
      initialValue: target.name,
      submitLabel: "Rename",
      onSubmit: (name) => {
        void renameEntry(target.path, name)
          .then(() => toast.success(`Renamed to “${name}”.`))
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `rename ${target.path}`, async () => { await renameEntry(target.path, name, true); }, "Couldn't rename image")) return;
            toast.error(cause instanceof ApiError && cause.status === 409 ? "That name is already in use" : cause instanceof Error ? cause.message : "Couldn't rename image");
          });
      },
    });
  };

  const deleteEntryByPath = (targetPath: string) => {
    const target = images.find((image) => image.path === targetPath);
    if (!target) return;
    requestConfirm({
      title: `Move “${target.name}” to Trash?`,
      body: `${target.path} will be removed from disk.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        void deleteEntry(target.path)
          .then(() => toast.success(`Deleted “${target.name}”.`))
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `delete ${target.path}`, async () => { await deleteEntry(target.path, true); }, "Couldn't delete image")) return;
            toast.error(cause instanceof Error ? cause.message : "Couldn't delete image");
          });
      },
    });
  };

  const deleteSelected = () => {
    if (!primary) return;
    deleteEntryByPath(primary.path);
  };

  const revealInFinder = (targetPath: string) => {
    openFinder(parentOf(targetPath));
  };

  const getInfo = (targetPath: string) => {
    const target = images.find((image) => image.path === targetPath);
    if (target) toast.info(describeEntry(target));
  };

  const openLoupe = (targetPath: string) => {
    const index = sortedImages.findIndex((image) => image.path === targetPath);
    if (index !== -1) setLoupeIndex(index);
  };

  const stepLoupe = (direction: 1 | -1) => {
    setLoupeIndex((current) => {
      if (current === null) return current;
      const next = current + direction;
      return next >= 0 && next < sortedImages.length ? next : current;
    });
  };

  // Menu-bar actions arrive over the shared CustomEvent channel.
  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action: GalleryMenuAction }>).detail;
      if (!detail || !primary) return;
      switch (detail.action) {
        case "rename":
          renameEntryByPath(primary.path);
          break;
        case "delete":
          deleteEntryByPath(primary.path);
          break;
        case "reveal":
          revealInFinder(primary.path);
          break;
        case "info":
          getInfo(primary.path);
          break;
      }
    };
    window.addEventListener("aqua-gallery-action", onAction);
    return () => window.removeEventListener("aqua-gallery-action", onAction);
  });

  // ---- keyboard (UI-SPEC-12 §9) ---------------------------------------------

  const onKeyDown = (event: React.KeyboardEvent) => {
    const currentIndex = loupeIndex ?? sortedImages.findIndex((image) => image.path === primaryPath);
    if (event.key === "Escape") {
      if (loupeIndex !== null) setLoupeIndex(null);
      else {
        setSelectedPaths(new Set());
        setPrimaryPath(null);
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (loupeIndex !== null) {
        stepLoupe(direction);
        return;
      }
      if (sortedImages.length === 0) return;
      const next = Math.min(sortedImages.length - 1, Math.max(0, (currentIndex === -1 ? -1 : currentIndex) + direction));
      const target = sortedImages[next];
      if (target) {
        setSelectedPaths(new Set([target.path]));
        setPrimaryPath(target.path);
        setAnchorPath(target.path);
        setScrollTargetPath(target.path);
      }
      return;
    }
    if (event.key === "Enter" && primary) {
      openLoupe(primary.path);
      return;
    }
    if (event.key === " " && primary) {
      event.preventDefault();
      openLoupe(primary.path); // Quick Look reuses the Loupe surface
      return;
    }
    if (event.key === "Delete" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      deleteSelected();
    }
  };

  // ---- context menu positioning (same pattern as Finder) --------------------

  useLayoutEffect(() => {
    if (!menu) return;
    const element = menuRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    setMenuPos({
      left: Math.min(Math.max(margin, menu.x), Math.max(margin, window.innerWidth - margin - rect.width)),
      top: Math.min(Math.max(margin, menu.y), Math.max(margin, window.innerHeight - margin - rect.height)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  // ---- render ---------------------------------------------------------------

  const crumbs = breadcrumbs(path);

  return (
    <div className="flex h-full min-w-0 flex-col text-xs" tabIndex={0} onKeyDown={onKeyDown} aria-label="Gallery">
      {/* Toolbar renders immediately in every state so the window never feels frozen */}
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-bg-hover bg-bg-elevated px-2">
        <button
          className="rounded p-1.5 text-text-secondary hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Parent folder"
          onClick={() => setPath(parentOf(path))}
          disabled={path === HOME_PATH}
        >
          <FiArrowUp aria-hidden="true" />
        </button>
        <nav className="flex min-w-0 items-center gap-1" aria-label="Folder path">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span className="text-text-disabled">/</span>}
              <button
                className={`truncate rounded px-1 py-1 hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent ${index === crumbs.length - 1 ? "text-text-primary" : "text-text-tertiary"}`}
                onClick={() => setPath(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {(["s", "m", "l"] as const).map((size) => (
            <button
              key={size}
              className={`rounded px-2 py-1 uppercase ${thumbSize === size ? "bg-accent-bg text-accent" : "text-text-tertiary hover:bg-bg-hover"} focus-visible:outline-2 focus-visible:outline-accent`}
              aria-label={`${size.toUpperCase()} thumbnails`}
              aria-pressed={thumbSize === size}
              onClick={() => setThumbSize(size)}
            >
              {size}
            </button>
          ))}
          <div className="relative">
            <select
              aria-label="Sort images by"
              value={sortBy}
              onChange={(event) => setSort(event.target.value as ImageSortKey, sortAscending)}
              className="appearance-none rounded bg-transparent py-1 pl-2 pr-6 text-[11px] text-text-secondary outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              {(Object.keys(SORT_LABELS) as ImageSortKey[]).map((key) => (
                <option key={key} value={key}>{SORT_LABELS[key]}</option>
              ))}
            </select>
            <FiChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-text-tertiary" aria-hidden="true" />
          </div>
          <button
            className={`rounded p-1.5 ${sortAscending ? "text-accent" : "text-text-tertiary rotate-180"} hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent`}
            aria-label={sortAscending ? "Sort descending" : "Sort ascending"}
            onClick={() => setSort(sortBy, !sortAscending)}
          >
            <FiArrowLeft className="-rotate-90" aria-hidden="true" />
          </button>
          <button
            className="rounded p-1.5 text-text-secondary hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Refresh folder"
            onClick={() => void load()}
          >
            <FiRefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>

      {loadState === "loading" && (
        <div className="grid auto-rows-max grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 p-3" aria-busy="true" aria-label="Loading images">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="h-[126px] animate-pulse rounded-card bg-bg-elevated/70" style={{ animationDelay: `${index * 40}ms` }} />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FiImage className="h-9 w-9 text-status-danger" aria-hidden="true" />
          <p className="font-medium text-text-primary">This folder is unavailable</p>
          {errorMessage && <p className="max-w-[320px] break-words font-mono text-[10px] text-text-tertiary">{errorMessage}</p>}
          <button
            className="rounded-card bg-accent px-3 py-1.5 font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      )}

      {loadState === "empty" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FiImage className="h-10 w-10 text-text-tertiary" aria-hidden="true" />
          <p className="font-medium text-text-primary">No images in this folder</p>
          {otherCount > 0 && (
            <p className="text-[11px] text-text-tertiary">{otherCount} other {otherCount === 1 ? "file" : "files"} here</p>
          )}
          <button
            className="rounded-card bg-accent px-3 py-1.5 font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => openFinder(path)}
          >
            Open in Finder
          </button>
        </div>
      )}

      {loadState === "populated" && (
        <>
          <GalleryGrid
            images={sortedImages}
            thumbSize={thumbSize}
            selected={selectedPaths}
            primaryPath={primaryPath}
            getThumb={(target) => {
              void cache.version;
              return cache.get(target);
            }}
            onRequestThumb={(target) => cache.request(target)}
            onSelect={select}
            onOpen={openLoupe}
            onContextMenu={(event, targetPath) => {
              event.preventDefault();
              event.stopPropagation();
              const target = sortedImages.find((image) => image.path === targetPath);
              if (!target) return;
              if (!selectedPaths.has(targetPath)) {
                setSelectedPaths(new Set([targetPath]));
                setPrimaryPath(targetPath);
                setAnchorPath(targetPath);
              }
              setMenu({ x: event.clientX, y: event.clientY, entry: target });
            }}
            scrollTargetPath={scrollTargetPath}
          />
          <div className="flex min-h-8 shrink-0 items-center border-t border-bg-hover bg-bg-elevated px-2">
            <span className="ml-auto text-[10px] text-text-tertiary">
              {sortedImages.length} {sortedImages.length === 1 ? "image" : "images"}
              {otherCount > 0 ? ` · ${otherCount} other ${otherCount === 1 ? "file" : "files"}` : ""}
              {selectedPaths.size > 1 ? ` · ${selectedPaths.size} selected` : ""}
            </span>
          </div>
        </>
      )}

      {loupeIndex !== null && sortedImages[loupeIndex] && (
        <Loupe
          name={sortedImages[loupeIndex].name}
          index={loupeIndex}
          total={sortedImages.length}
          state={((): ThumbnailState => {
            void cache.version;
            return cache.get(sortedImages[loupeIndex].path);
          })()}
          onClose={() => setLoupeIndex(null)}
          onPrev={() => stepLoupe(-1)}
          onNext={() => stepLoupe(1)}
          onRetry={() => cache.request(sortedImages[loupeIndex].path, true)}
          onRename={() => renameEntryByPath(sortedImages[loupeIndex].path)}
          onDelete={() => deleteEntryByPath(sortedImages[loupeIndex].path)}
          onReveal={() => revealInFinder(sortedImages[loupeIndex].path)}
        />
      )}

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] min-w-44 rounded-card border border-bg-hover bg-bg-elevated p-1 font-sans shadow-xl"
            style={{ left: menuPos.left, top: menuPos.top }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { openLoupe(menu.entry.path); setMenu(null); }}>
              Open
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { renameEntryByPath(menu.entry.path); setMenu(null); }}>
              Rename
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-status-danger hover:bg-bg-hover" onClick={() => { deleteEntryByPath(menu.entry.path); setMenu(null); }}>
              Move to Trash
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { revealInFinder(menu.entry.path); setMenu(null); }}>
              Reveal in Finder
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { getInfo(menu.entry.path); setMenu(null); }}>
              Get Info
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
