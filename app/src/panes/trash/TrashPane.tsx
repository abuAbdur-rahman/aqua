import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiArrowDownRight,
  FiRefreshCw,
  FiRotateCcw,
  FiTrash2,
  FiX,
} from "react-icons/fi";
import {
  emptyTrash,
  listTrash,
  NeedsElevationError,
  permanentDelete,
  restoreFromTrash,
  type TrashEntry,
} from "../../lib/filesystem";
import { useFsWatch } from "../../lib/useFsWatch";
import { useModalStore } from "../../system/modalStore";
import { toast } from "../../system/toast";

type LoadState = "loading" | "empty" | "populated" | "error";

const TRASH_DIR = "~/.local/share/aqua/Trash";
const PURGE_AFTER_DAYS = 7;

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function relativeTime(value: string) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function purgeCountdown(value: string) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const daysLeft = PURGE_AFTER_DAYS - Math.floor((Date.now() - then) / 86_400_000);
  if (daysLeft <= 0) return "Purges soon";
  return daysLeft === 1 ? "Purges in 1 day" : `Purges in ${daysLeft} days`;
}

function breadcrumb(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-3).join("/")}`;
}

export function TrashPane() {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Multi-select: click sets sole selection, Cmd-click toggles, Shift-click
  // extends a range — same conventions as Finder/Gallery.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; entry: TrashEntry } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorIndexRef = useRef<number>(-1);
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const requestElevate = useModalStore((s) => s.requestElevate);

  const load = useCallback(async () => {
    try {
      const next = await listTrash();
      setEntries(next);
      setSelectedIds((current) => new Set([...current].filter((id) => next.some((entry) => entry.id === id))));
      setLoadState(next.length === 0 ? "empty" : "populated");
    } catch (cause: unknown) {
      setLoadState("error");
      toast.error(cause instanceof Error ? cause.message : "Couldn't load Trash");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Coarse signal: anything inside the trash dir means the bucket changed.
  // Entries carry derived metadata the raw events don't have, so refetch
  // instead of reconciling partial events.
  useFsWatch(TRASH_DIR, () => void load());

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  const sortedEntries = useMemo(
    () =>
      [...entries].sort(
        (left, right) => new Date(right.deletedAt).getTime() - new Date(left.deletedAt).getTime(),
      ),
    [entries],
  );

  const selectedCount = selectedIds.size;

  const selectEntry = (entry: TrashEntry, index: number, event: React.MouseEvent) => {
    if (event.shiftKey && anchorIndexRef.current !== -1) {
      const [start, end] = [anchorIndexRef.current, index].sort((a, b) => a - b);
      setSelectedIds(new Set(sortedEntries.slice(start, end + 1).map((item) => item.id)));
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
    } else {
      setSelectedIds(new Set([entry.id]));
    }
    anchorIndexRef.current = index;
  };

  // Same retry-with-elevation pattern Finder uses: on needsElevation open the
  // shared ElevateModal, then replay the exact operation once authenticated.
  const handleElevation = (
    cause: unknown,
    detail: string,
    retry: () => Promise<unknown>,
    fallback: string,
  ): boolean => {
    if (!(cause instanceof NeedsElevationError)) return false;
    requestElevate({
      appName: "Trash",
      detail: `${detail} requires your password.`,
      onSuccess: () => {
        void retry().catch(() => toast.error(fallback));
      },
    });
    return true;
  };

  const restore = (entry: TrashEntry) => {
    void restoreFromTrash(entry.id)
      .then(() => {
        toast.success(`Restored “${entry.name}”.`);
        return load();
      })
      .catch((cause: unknown) => {
        if (handleElevation(cause, `Restore “${entry.name}”`, async () => { await restoreFromTrash(entry.id, true); }, `Couldn't restore “${entry.name}”`)) return;
        toast.error(cause instanceof Error ? cause.message : `Couldn't restore “${entry.name}”`);
      });
  };

  const deletePermanently = (entry: TrashEntry) => {
    requestConfirm({
      title: `Delete “${entry.name}” permanently?`,
      body: `${entry.originalPath} will be removed from disk. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        // Permanent deletion is password-gated by the daemon: authenticate
        // first, then replay the operation elevated. needsElevation can still
        // surface if the grant expires in between — the fallback re-prompts.
        requestElevate({
          appName: "Trash",
          detail: `Deleting “${entry.name}” permanently requires your password.`,
          onSuccess: () => {
            void permanentDelete(entry.id, true)
              .then(load)
              .catch((cause: unknown) => {
                if (handleElevation(cause, `Delete “${entry.name}” permanently`, async () => { await permanentDelete(entry.id, true); }, `Couldn't delete “${entry.name}”`)) return;
                toast.error(cause instanceof Error ? cause.message : `Couldn't delete “${entry.name}”`);
              });
          },
        });
      },
    });
  };

  const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);

  const showEmptyTrashConfirm = () => {
    requestConfirm({
      title: "Empty Trash?",
      body: `This permanently deletes ${entries.length} ${entries.length === 1 ? "item" : "items"} (${formatSize(totalSize)}). This can't be undone.`,
      confirmLabel: "Empty Trash",
      danger: true,
      onConfirm: () => {
        // Same password gate as single-item permanent deletion: authenticate,
        // then replay elevated. The catch handles grant-expiry races.
        requestElevate({
          appName: "Trash",
          detail: "Emptying the Trash requires your password.",
          onSuccess: () => {
            void emptyTrash(true)
              .then(load)
              .catch((cause: unknown) => {
                if (handleElevation(cause, "Empty the Trash", async () => { await emptyTrash(true); }, "Couldn't empty Trash")) return;
                toast.error(cause instanceof Error ? cause.message : "Couldn't empty Trash");
              });
          },
        });
      },
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-col text-xs" onClick={() => setMenu(null)}>
      <div className="flex min-h-9 items-center gap-1 border-b border-bg-hover bg-bg-elevated px-2">
        <span className="font-medium text-text-primary">Trash</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary" aria-label="Refresh Trash" onClick={(event) => { event.stopPropagation(); void load(); }}>
            <FiRefreshCw aria-hidden="true" />
          </button>
          <button
            className="rounded-card bg-bg-hover px-2.5 py-1 font-medium text-status-danger hover:bg-status-danger/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-bg-hover"
            disabled={loadState === "empty" || loadState === "loading" || entries.length === 0}
            onClick={showEmptyTrashConfirm}
          >
            Empty Trash
          </button>
        </div>
      </div>

      {loadState === "loading" && (
        <div className="space-y-2 p-3" aria-label="Loading Trash" aria-busy="true">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-7 rounded bg-bg-hover/60 animate-pulse" />
          ))}
        </div>
      )}

      {loadState === "error" && !entries.length && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FiTrash2 className="h-9 w-9 text-status-danger" aria-hidden="true" />
          <p className="font-medium text-text-primary">Trash is unavailable</p>
          <button className="rounded-card bg-accent px-3 py-1.5 font-medium text-bg-base hover:bg-accent-strong" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {loadState === "empty" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FiTrash2 className="h-10 w-10 text-text-tertiary" aria-hidden="true" />
          <p className="font-medium text-text-primary">Trash is empty</p>
          <p className="text-text-tertiary">Items you move to Trash stay here for {PURGE_AFTER_DAYS} days.</p>
        </div>
      )}

      {loadState === "populated" && (
        <>
          {/* Destructive actions are click-only by design (UI-SPEC-15 §3):
              arrow keys move selection, Enter does nothing. */}
          <div
            className="min-h-0 flex-1 overflow-auto"
            role="grid"
            aria-label="Trashed items"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          >
            {sortedEntries.map((entry, index) => (
              <button
                key={entry.id}
                role="row"
                aria-selected={selectedIds.has(entry.id)}
                className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover/60 ${selectedIds.has(entry.id) ? "bg-accent-bg" : ""}`}
                onClick={(event) => selectEntry(entry, index, event)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!selectedIds.has(entry.id)) setSelectedIds(new Set([entry.id]));
                  anchorIndexRef.current = index;
                  setMenu({ x: event.clientX, y: event.clientY, entry });
                }}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-text-primary">{entry.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-[10px] text-text-tertiary">
                    {entry.kind === "dir" ? <FiArrowDownRight aria-hidden="true" /> : null}
                    {breadcrumb(entry.originalPath)} · {relativeTime(entry.deletedAt)}
                    {purgeCountdown(entry.deletedAt) && ` · ${purgeCountdown(entry.deletedAt)}`}
                  </span>
                </span>
                <span className="text-text-tertiary">{entry.kind === "dir" ? "—" : formatSize(entry.size)}</span>
                <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{entry.kind}</span>
              </button>
            ))}
          </div>
          <div className="flex min-h-8 items-center border-t border-bg-hover bg-bg-elevated px-2">
            <span className="ml-auto text-[10px] text-text-tertiary">
              {entries.length} {entries.length === 1 ? "item" : "items"}, {formatSize(totalSize)}
            </span>
          </div>
        </>
      )}

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] min-w-44 rounded-card border border-bg-hover bg-bg-elevated p-1 font-sans shadow-xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 90) }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover"
              onClick={() => {
                restore(menu.entry);
                setMenu(null);
              }}
            >
              <FiRotateCcw aria-hidden="true" /> Restore{selectedCount > 1 ? ` ${selectedCount} Items` : ""}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-status-danger hover:bg-bg-hover"
              onClick={() => {
                deletePermanently(menu.entry);
                setMenu(null);
              }}
            >
              <FiX aria-hidden="true" /> Delete Permanently{selectedCount > 1 ? ` (${selectedCount})` : ""}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
