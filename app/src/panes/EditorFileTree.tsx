import { useCallback, useEffect, useState } from "react";
import { FiChevronRight, FiFile, FiFolder } from "react-icons/fi";
import { listDirectory, type FsEntry } from "../lib/filesystem";
import { useFsWatch } from "../lib/useFsWatch";

const HEAVY = new Set(["node_modules", "target", ".git", "dist", "build"]);

interface Props {
  root: string;
  onOpenFile: (path: string) => void;
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === "dir" ? 0 : 1;
    const bDir = b.kind === "dir" ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });
}

function Node({ path, name, depth, onOpenFile, refreshToken }: { path: string; name: string; depth: number; onOpenFile: (p: string) => void; refreshToken: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listDirectory(path)
      .then((entries) => {
        setChildren(sortEntries(entries));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Unable to list folder"));
  }, [path]);

  useEffect(() => {
    if (expanded && children === null) load();
  }, [expanded, children, load]);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load, refreshToken]);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-expanded={expanded}
      >
        <FiChevronRight aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <FiFolder aria-hidden="true" className="shrink-0" />
        <span className="truncate">{name}</span>
      </button>
      {expanded && (
        <div>
          {error && <p className="px-3 py-1 text-[11px] text-status-danger">{error}</p>}
          {children === null && !error && <p className="px-3 py-1 text-[11px] text-text-tertiary">Loading…</p>}
          {children?.map((child) =>
            child.kind === "dir" ? (
              <Node key={child.path} path={child.path} name={child.name} depth={depth + 1} onOpenFile={onOpenFile} refreshToken={refreshToken} />
            ) : (
              <button
                key={child.path}
                onClick={() => onOpenFile(child.path)}
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                style={{ paddingLeft: 8 + (depth + 1) * 12 }}
              >
                <span className="w-3 shrink-0" aria-hidden="true" />
                <FiFile aria-hidden="true" className="shrink-0" />
                <span className="truncate">{child.name}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function EditorFileTree({ root, onOpenFile }: Props) {
  const [width, setWidth] = useState(240);
  const [refreshToken, setRefreshToken] = useState(0);

  useFsWatch(root, () => setRefreshToken((t) => t + 1));

  return (
    <div className="relative flex h-full shrink-0 bg-bg-elevated" style={{ width }} aria-label="Folder tree">
      <div className="min-w-0 flex-1 overflow-auto py-1">
        <Node path={root} name={root.split("/").filter(Boolean).pop() ?? root} depth={0} onOpenFile={onOpenFile} refreshToken={refreshToken} />
        <p className="px-3 py-2 text-[11px] text-text-tertiary">
          Heavy folders ({[...HEAVY].join(", ")}) stay collapsed until opened.
        </p>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        className="w-1 cursor-col-resize hover:bg-accent/40"
        onPointerDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = width;
          const onMove = (ev: PointerEvent) => setWidth(Math.min(480, Math.max(160, startW + ev.clientX - startX)));
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />
    </div>
  );
}
