import { FiAlertTriangle, FiChevronLeft, FiChevronRight, FiEdit3, FiFolder, FiTrash2, FiX } from "react-icons/fi";
import type { ThumbnailState } from "./useThumbnailCache";

interface LoupeProps {
  name: string;
  index: number;
  total: number;
  state: ThumbnailState;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onRetry: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReveal: () => void;
}

export function Loupe({
  name,
  index,
  total,
  state,
  onClose,
  onPrev,
  onNext,
  onRetry,
  onRename,
  onDelete,
  onReveal,
}: LoupeProps) {
  return (
    <div
      className="group/loupe absolute inset-0 z-20 flex flex-col bg-bg-overlay"
      role="dialog"
      aria-label={`Viewing ${name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "ArrowLeft") onPrev();
        if (event.key === "ArrowRight") onNext();
      }}
      tabIndex={0}
    >
      <header className="flex shrink-0 items-center justify-between px-3 py-2">
        <span className="truncate text-xs font-medium text-text-primary">{name} — {index + 1} / {total}</span>
        <button
          className="rounded p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Close viewer (Esc)"
          onClick={onClose}
        >
          <FiX aria-hidden="true" />
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {state.status === "loaded" && state.url && (
          <img src={state.url} alt={name} className="max-h-full max-w-full object-contain" />
        )}
        {state.status === "loading" && (
          <div className="relative flex h-full w-full items-center justify-center">
            <div className="h-40 w-40 animate-pulse rounded-card bg-bg-elevated" aria-hidden="true" />
            <div
              className="absolute h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
              role="status"
              aria-label="Loading image"
            />
          </div>
        )}
        {state.status === "error" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <FiAlertTriangle className="h-10 w-10 text-status-danger" aria-hidden="true" />
            <p className="text-xs font-medium text-text-primary">Couldn't load this image</p>
            <p className="max-w-[280px] text-[11px] text-text-tertiary">{state.error}</p>
            <button
              className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        )}

        {index > 0 && (
          <button
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-bg-elevated/80 p-2 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Previous image (Left arrow)"
            onClick={onPrev}
          >
            <FiChevronLeft aria-hidden="true" />
          </button>
        )}
        {index < total - 1 && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-bg-elevated/80 p-2 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Next image (Right arrow)"
            onClick={onNext}
          >
            <FiChevronRight aria-hidden="true" />
          </button>
        )}
      </div>

      <footer className="flex shrink-0 justify-center pb-3 opacity-0 transition-opacity duration-150 group-hover/loupe:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-1 rounded-card border border-bg-hover bg-bg-elevated p-1 shadow-lg">
          <button
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onRename}
          >
            <FiEdit3 aria-hidden="true" /> Rename
          </button>
          <button
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-status-danger hover:bg-status-danger/10 focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onDelete}
          >
            <FiTrash2 aria-hidden="true" /> Move to Trash
          </button>
          <button
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onReveal}
          >
            <FiFolder aria-hidden="true" /> Reveal in Finder
          </button>
        </div>
      </footer>
    </div>
  );
}
