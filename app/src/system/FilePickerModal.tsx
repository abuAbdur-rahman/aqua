import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiArrowLeft, FiFile, FiFolder } from "react-icons/fi";
import { listDirectory, type FsEntry } from "../lib/filesystem";
import { useModalStore } from "./modalStore";
import { useModalBehavior } from "./useModalBehavior";

const HOME = ".";

function parentOf(path: string) {
  if (path === HOME || path === "/") return HOME;
  const normalized = path.replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? HOME : normalized.slice(0, index);
}

function breadcrumbsOf(path: string) {
  if (path === HOME) return [{ label: "~", path: HOME }];
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: path.startsWith("/") ? `/${parts.slice(0, index + 1).join("/")}` : parts.slice(0, index + 1).join("/"),
  }));
}

/** Absolute path of the browsed dir, derived from a child entry when the dir
 *  itself is relative ("." for home — the daemon returns "./name" children). */
function resolveDir(dir: string, entries: FsEntry[]) {
  if (dir !== HOME) return dir.replace(/\/$/, "");
  const first = entries[0];
  if (!first) return HOME;
  return first.path.slice(0, -(first.name.length + 1)).replace(/\/$/, "") || HOME;
}

export function FilePickerModal() {
  const request = useModalStore((s) => s.filePicker);
  const closeFilePicker = useModalStore((s) => s.closeFilePicker);
  const [dir, setDir] = useState(HOME);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [name, setName] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = request != null;
  useModalBehavior(open, panelRef, closeFilePicker, open && request?.mode === "save" ? inputRef : panelRef);

  const load = useCallback(async (target: string) => {
    setLoadState("loading");
    setSelected(null);
    try {
      const next = await listDirectory(target);
      setEntries(next.filter((entry) => !entry.name.startsWith(".")));
      setLoadState("ready");
    } catch {
      setEntries([]);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (!request) return;
    const start = request.initialDir?.trim() || HOME;
    setDir(start);
    setName(request.defaultName ?? "");
    void load(start);
  }, [request, load]);

  const sorted = [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const activate = (entry: FsEntry) => {
    if (entry.kind === "dir") {
      setDir(entry.path);
      void load(entry.path);
      return;
    }
    if (request?.mode === "open") {
      closeFilePicker();
      request.onSubmit(entry.path);
    } else if (request?.mode === "save") {
      setName(entry.name);
    }
  };

  const submit = () => {
    if (!request) return;
    const base = resolveDir(dir, entries);
    if (request.mode === "save") {
      const trimmed = name.trim();
      if (!trimmed) return;
      closeFilePicker();
      request.onSubmit(`${base}/${trimmed}`);
      return;
    }
    const target = request.mode === "selectFolder" ? selected?.path ?? base : selected?.path;
    if (!target) return;
    closeFilePicker();
    request.onSubmit(target);
  };

  const submitEnabled =
    request != null &&
    (request.mode === "save"
      ? name.trim().length > 0
      : request.mode === "selectFolder"
        ? loadState === "ready"
        : selected?.kind === "file");

  return (
    <AnimatePresence>
      {open && request && (
        <motion.div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-bg-base/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="w-full max-w-[520px]"
            style={{ willChange: "transform, opacity" }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={request.title}
              className="overflow-hidden rounded-[10px] border border-bg-hover bg-bg-overlay shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            >
              <h2 className="px-4 pt-4 text-sm font-semibold text-text-primary">{request.title}</h2>

              <div className="mt-3 flex items-center gap-1 border-b border-bg-hover px-3 pb-2 text-xs">
                <button
                  type="button"
                  aria-label="Enclosing folder"
                  disabled={dir === HOME}
                  className="rounded p-1 text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                  onClick={() => {
                    const next = parentOf(dir);
                    setDir(next);
                    void load(next);
                  }}
                >
                  <FiArrowLeft aria-hidden="true" />
                </button>
                <div className="flex min-w-0 items-center gap-1">
                  {breadcrumbsOf(dir).map((crumb, index, all) => (
                    <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                      {index > 0 && <span className="text-text-disabled">/</span>}
                      <button
                        type="button"
                        className={`truncate rounded px-1 py-0.5 hover:bg-bg-hover ${index === all.length - 1 ? "text-text-primary" : "text-text-tertiary"}`}
                        onClick={() => {
                          setDir(crumb.path);
                          void load(crumb.path);
                        }}
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="h-64 overflow-auto p-1" role="listbox" aria-label="Files and folders">
                {loadState === "loading" && (
                  <div className="space-y-1 p-2" aria-busy="true">
                    {Array.from({ length: 5 }, (_, index) => (
                      <div key={index} className="h-6 animate-pulse rounded bg-bg-hover/60" />
                    ))}
                  </div>
                )}
                {loadState === "error" && (
                  <div className="flex h-full items-center justify-center text-xs text-text-tertiary">Couldn't read this folder.</div>
                )}
                {loadState === "ready" && sorted.length === 0 && (
                  <div className="flex h-full items-center justify-center text-xs text-text-tertiary">This folder is empty.</div>
                )}
                {loadState === "ready" &&
                  sorted.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      role="option"
                      aria-selected={selected?.path === entry.path}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                        selected?.path === entry.path ? "bg-accent-bg text-accent" : "text-text-primary hover:bg-bg-hover"
                      }`}
                      onClick={() => {
                        if (request.mode === "selectFolder" && entry.kind === "dir") setSelected(entry);
                        else if (request.mode === "open" && entry.kind === "file") setSelected(entry);
                        else if (request.mode === "save" && entry.kind === "file") setName(entry.name);
                      }}
                      onDoubleClick={() => activate(entry)}
                    >
                      {entry.kind === "dir" ? <FiFolder className="shrink-0 text-accent" aria-hidden="true" /> : <FiFile className="shrink-0 text-text-secondary" aria-hidden="true" />}
                      <span className="truncate">{entry.name}</span>
                    </button>
                  ))}
              </div>

              <form
                className="flex items-center gap-2 border-t border-bg-hover px-4 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                {request.mode === "save" ? (
                  <input
                    ref={inputRef}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-label="File name"
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-card bg-bg-hover px-3 py-1.5 text-xs text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-text-tertiary">
                    {request.mode === "selectFolder" ? resolveDir(dir, entries) : (selected?.name ?? "No file selected")}
                  </span>
                )}
                <button
                  type="button"
                  onClick={closeFilePicker}
                  className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!submitEnabled}
                  className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
                >
                  {request.submitLabel ?? (request.mode === "save" ? "Save" : "Open")}
                </button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
