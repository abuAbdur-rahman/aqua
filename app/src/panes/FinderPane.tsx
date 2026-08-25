import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiArrowUp,
  FiChevronDown,
  FiChevronRight,
  FiCode,
  FiEdit3,
  FiEye,
  FiEyeOff,
  FiFile,
  FiFilePlus,
  FiFileText,
  FiFolder,
  FiFolderPlus,
  FiGrid,
  FiImage,
  FiList,
  FiBookmark,
  FiRefreshCw,
  FiTrash2,
  FiTerminal,
  FiX,
} from "react-icons/fi";
import {
  ApiError,
  createDirectory,
  createFile,
  deleteEntry,
  listDirectory,
  NeedsElevationError,
  readFile,
  renameEntry,
  type FsEntry,
} from "../lib/filesystem";
import { useFsWatch } from "../lib/useFsWatch";
import { useModalStore } from "../system/modalStore";
import { toast } from "../system/toast";
import { useWindowStore } from "../windows/store";

type ViewMode = "list" | "icons";
type LoadState = "loading" | "empty" | "populated" | "error";

const HOME_PATH = ".";
const PINNED_KEY = "aqua.finder.pinned";

interface PinnedFolder {
  name: string;
  path: string;
}

function readPinned(): PinnedFolder[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is PinnedFolder =>
        typeof item === "object" && item !== null &&
        typeof (item as PinnedFolder).name === "string" &&
        typeof (item as PinnedFolder).path === "string",
    );
  } catch {
    return [];
  }
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function isImage(entry: FsEntry) {
  return entry.kind === "file" && /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(entry.name);
}

function isPreviewable(entry: FsEntry) {
  return entry.kind === "file" && /\.(md|mdx|txt|json|ts|tsx|js|jsx|rs|toml|css|html|yaml|yml)$/i.test(entry.name);
}

function entryIcon(entry: FsEntry) {
  if (entry.kind === "dir") return <FiFolder className="text-accent" aria-hidden="true" />;
  if (entry.kind === "symlink") return <FiFile className="text-status-info" aria-hidden="true" />;
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(entry.name)) return <FiImage className="text-status-warning" aria-hidden="true" />;
  if (/\.(md|txt|json|toml)$/i.test(entry.name)) return <FiFileText className="text-text-secondary" aria-hidden="true" />;
  return <FiCode className="text-text-secondary" aria-hidden="true" />;
}

function parentPath(path: string) {
  if (path === HOME_PATH || path === "/") return HOME_PATH;
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function breadcrumbs(path: string) {
  if (path === HOME_PATH) return [{ label: "Home", path: HOME_PATH }];
  const parts = path.replace(/^\.\//, "").split("/").filter(Boolean);
  const stem = path.replace(/^\.\//, "");
  return [{ label: "Home", path: HOME_PATH }, ...parts.map((part, index) => ({
    label: part,
    path: stem.startsWith("/") ? `/${parts.slice(0, index + 1).join("/")}` : `./${parts.slice(0, index + 1).join("/")}`,
  }))];
}

function TreeRow({ entry, depth, showHidden, onOpen }: { entry: FsEntry; depth: number; showHidden: boolean; onOpen: (path: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const toggle = () => {
    if (!expanded && !loaded) {
      void listDirectory(entry.path)
        .then((next) => setChildren(next.filter((item) => item.kind === "dir" && (showHidden || !item.name.startsWith(".")))))
        .catch(() => setChildren([]))
        .finally(() => setLoaded(true));
    }
    setExpanded((value) => !value);
  };

  return (
    <div>
      <div className="flex items-center rounded pr-1 hover:bg-bg-hover" style={{ paddingLeft: depth * 12 }}>
        <button className="shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-primary" aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`} aria-expanded={expanded} onClick={toggle}>
          {expanded ? <FiChevronDown size={12} aria-hidden="true" /> : <FiChevronRight size={12} aria-hidden="true" />}
        </button>
        <button className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-text-secondary hover:text-text-primary" onClick={() => { if (!expanded) toggle(); onOpen(entry.path); }}>
          <FiFolder className="shrink-0 text-accent" aria-hidden="true" />
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {expanded && children?.map((child) => (
        <TreeRow key={child.path} entry={child} depth={depth + 1} showHidden={showHidden} onOpen={onOpen} />
      ))}
    </div>
  );
}

export function FinderPane() {
  const [path, setPath] = useState(HOME_PATH);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entry: FsEntry; content?: string; encoding?: string; error?: string } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [view, setView] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<keyof FsEntry>("name");
  const [sortAscending, setSortAscending] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(HOME_PATH);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FsEntry | null } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [showHidden, setShowHidden] = useState(false);
  const [pinned, setPinned] = useState<PinnedFolder[]>(readPinned);
  const menuRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const openEditor = useWindowStore((state) => state.openEditor);
  const openTerminal = useWindowStore((state) => state.openApp);
  const openGallery = useWindowStore((state) => state.openGallery);
  const finderPathRequest = useWindowStore((state) => state.finderPathRequest);
  const clearFinderPathRequest = useWindowStore((state) => state.clearFinderPathRequest);
  const requestElevate = useModalStore((s) => s.requestElevate);
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const requestFilePicker = useModalStore((s) => s.requestFilePicker);
  const requestPrompt = useModalStore((s) => s.requestPrompt);

  const visibleEntries = useMemo(
    () => (showHidden ? entries : entries.filter((entry) => !entry.name.startsWith("."))),
    [entries, showHidden],
  );

  const persistPinned = (next: PinnedFolder[]) => {
    setPinned(next);
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    } catch {
      // pinning stays in-memory when storage is unavailable
    }
  };

  // On needsElevation, open the shared ElevateModal and retry the same op
  // with elevated: true once authentication succeeds.
  const handleNeedsElevation = (cause: unknown, detail: string, retry: () => Promise<void>, fallback: string): boolean => {
    if (!(cause instanceof NeedsElevationError)) return false;
    requestElevate({
      appName: "Finder",
      detail: `${detail} requires your password.`,
      onSuccess: () => {
        void retry().catch((retryCause: unknown) =>
          toast.error(retryCause instanceof Error ? retryCause.message : fallback),
        );
      },
    });
    return true;
  };

  useEffect(() => {
    if (finderPathRequest) {
      setPath(finderPathRequest);
      clearFinderPathRequest();
    }
  }, [clearFinderPathRequest, finderPathRequest]);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const next = await listDirectory(path);
      setEntries(next);
      setLoadState(next.length === 0 ? "empty" : "populated");
      setSelectedPath((current) => next.some((entry) => entry.path === current) ? current : null);
    } catch (cause: unknown) {
      setLoadState("error");
      toast.error(cause instanceof Error ? cause.message : "Unable to read this folder");
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPathInput(path);
  }, [path]);

  const onWatchEvent = useCallback((event: import("../lib/filesystem").FsWatchEvent) => {
    const firstEntry = entries[0];
    const currentPath = path === HOME_PATH && firstEntry
      ? firstEntry.path.slice(0, -(firstEntry.name.length + 1))
      : path;
    if (parentPath(event.path) === currentPath) void load();
  }, [entries, load, path]);

  useFsWatch(path, onWatchEvent);

  // Close the context menu on any outside press. Required because the menu is
  // portaled to document.body, so it falls outside the window's own DOM.
  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  // Flip the context menu up/left when it would overflow the viewport so the
  // last item is never clipped below the screen edge.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const maxLeft = window.innerWidth - margin - rect.width;
    const maxTop = window.innerHeight - margin - rect.height;
    setMenuPos({
      left: Math.min(Math.max(margin, menu.x), Math.max(margin, maxLeft)),
      top: Math.min(Math.max(margin, menu.y), Math.max(margin, maxTop)),
    });
  }, [menu]);

  // Ctrl+H toggles hidden files while Finder has the focused window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault();
        setShowHidden((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Preview pane resize: drag the left edge.
  useEffect(() => {
    if (!showPreview) return;
    const handle = previewRef.current;
    if (!handle) return;
    let dragging = false;
    const onDown = (event: MouseEvent) => {
      event.preventDefault();
      dragging = true;
    };
    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      setPreviewWidth(Math.min(520, Math.max(200, window.innerWidth - event.clientX)));
    };
    const onUp = () => {
      dragging = false;
    };
    handle.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      handle.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [showPreview]);

  const sortedEntries = useMemo(() => [...visibleEntries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    const leftValue = left[sortKey];
    const rightValue = right[sortKey];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue));
    return sortAscending ? comparison : -comparison;
  }), [visibleEntries, sortAscending, sortKey]);

  const selected = visibleEntries.find((entry) => entry.path === selectedPath) ?? null;

  const selectEntry = async (entry: FsEntry) => {
    setSelectedPath(entry.path);
    if (entry.kind !== "file") return;
    setShowPreview(true);
    setPreview({ entry });
    if (isImage(entry)) {
      try {
        const result = await readFile(entry.path);
        setPreview({ entry, content: result.content, encoding: result.encoding, error: result.truncated ? "Preview truncated for large file" : undefined });
      } catch (cause: unknown) {
        setPreview({ entry, error: cause instanceof Error ? cause.message : "Unable to preview file" });
      }
      return;
    }
    if (!isPreviewable(entry)) return;
    try {
      const result = await readFile(entry.path);
      setPreview({ entry, content: result.encoding === "utf8" ? result.content : undefined, error: result.truncated ? "Preview truncated for large file" : undefined });
    } catch (cause: unknown) {
      setPreview({ entry, error: cause instanceof Error ? cause.message : "Unable to preview file" });
    }
  };

  const activate = (entry: FsEntry) => {
    if (entry.kind === "dir") {
      setPath(entry.path);
      setSelectedPath(null);
      setPreview(null);
      return;
    }
    void selectEntry(entry);
  };

  const newFolder = () => {
    requestFilePicker({
      mode: "save",
      title: "New Folder",
      submitLabel: "Create",
      defaultName: "New Folder",
      initialDir: path,
      onSubmit: (target) => {
        void createDirectory(target)
          .then(() => {
            toast.success(`Created “${target.split("/").pop()}”.`);
            return load();
          })
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `createDir ${target}`, async () => { await createDirectory(target, true); await load(); }, "Couldn't create folder")) return;
            toast.error(cause instanceof Error ? cause.message : "Couldn't create folder");
          });
      },
    });
  };

  const newFile = () => {
    requestFilePicker({
      mode: "save",
      title: "New File",
      submitLabel: "Create",
      defaultName: "untitled.txt",
      initialDir: path,
      onSubmit: (target) => {
        void createFile(target)
          .then(() => {
            toast.success(`Created “${target.split("/").pop()}”.`);
            return load();
          })
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `createFile ${target}`, async () => { await createFile(target, true); await load(); }, "Couldn't create file")) return;
            toast.error(cause instanceof ApiError && cause.status === 409 ? "That name is already in use" : cause instanceof Error ? cause.message : "Couldn't create file");
          });
      },
    });
  };

  const showMenu = (event: React.MouseEvent, entry: FsEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const remove = () => {
    if (!selected) return;
    requestConfirm({
      title: `Delete “${selected.name}” permanently?`,
      body: `${selected.path} will be removed from disk.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        void deleteEntry(selected.path)
          .then(() => {
            setSelectedPath(null);
            setPreview(null);
            toast.success(`Deleted “${selected.name}”.`);
            return load();
          })
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `delete ${selected.path}`, async () => { await deleteEntry(selected.path, true); setSelectedPath(null); setPreview(null); await load(); }, "Couldn't delete item")) return;
            toast.error(cause instanceof Error ? cause.message : "Couldn't delete item");
          });
      },
    });
  };

  const renameSelected = () => {
    if (!selected) return;
    const target = selected;
    // Rename is a text entry, not a path choice — the shared prompt fits;
    // the file picker is reserved for file/folder selection and creation.
    requestPrompt({
      title: "Rename",
      label: "New name",
      initialValue: target.name,
      submitLabel: "Rename",
      onSubmit: (name) => {
        void renameEntry(target.path, name)
          .then(() => {
            toast.success(`Renamed to “${name}”.`);
            return load();
          })
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `rename ${target.path} → ${name}`, async () => { await renameEntry(target.path, name, true); await load(); }, "Couldn't rename item")) return;
            toast.error(cause instanceof ApiError && cause.status === 409 ? "That name is already in use" : cause instanceof Error ? cause.message : "Couldn't rename item");
          });
      },
    });
  };

  const pinSelected = () => {
    if (!selected || selected.kind !== "dir") return;
    if (pinned.some((item) => item.path === selected.path)) return;
    persistPinned([...pinned, { name: selected.name, path: selected.path }]);
    toast.success(`Pinned “${selected.name}” to sidebar.`);
  };

  const toggleSort = (key: keyof FsEntry) => {
    if (sortKey === key) setSortAscending((value) => !value);
    else {
      setSortKey(key);
      setSortAscending(true);
    }
  };

  const submitPath = () => {
    const nextPath = pathInput.trim();
    if (nextPath) setPath(nextPath);
    else setPathInput(path);
    setEditingPath(false);
  };

  const quickLocations = [
    { label: "Home", path: HOME_PATH },
    { label: "Projects", path: "./Projects" },
    { label: "Downloads", path: "./Downloads" },
    { label: "Documents", path: "./Documents" },
  ];

  const sidebarAction = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      className="rounded-card p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-full min-w-0 text-xs">
      {showSidebar && (
        <aside className="flex w-44 shrink-0 flex-col border-r border-bg-hover bg-bg-elevated p-2" aria-label="Finder sidebar">
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Finder actions">
            {sidebarAction("New file", <FiFilePlus aria-hidden="true" />, newFile)}
            {sidebarAction("New folder", <FiFolderPlus aria-hidden="true" />, newFolder)}
            {sidebarAction("Refresh", <FiRefreshCw aria-hidden="true" />, () => void load())}
            {sidebarAction("Parent folder", <FiArrowUp aria-hidden="true" />, () => setPath(parentPath(path)))}
            {sidebarAction(showHidden ? "Hide hidden files" : "Show hidden files", showHidden ? <FiEye aria-hidden="true" /> : <FiEyeOff aria-hidden="true" />, () => setShowHidden((value) => !value))}
          </div>

          <nav className="mt-3" aria-label="Locations">
            {quickLocations.map((location) => (
              <button
                key={location.label}
                className={`flex min-h-7 w-full items-center gap-2 rounded-card px-2 text-left ${path === location.path ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-bg-hover"}`}
                onClick={() => setPath(location.path)}
              >
                <FiFolder aria-hidden="true" /> {location.label}
              </button>
            ))}
            {pinned.map((item) => (
              <div key={item.path} className="group flex min-h-7 items-center">
                <button
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-card px-2 py-1 text-left ${path === item.path ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-bg-hover"}`}
                  onClick={() => setPath(item.path)}
                >
                  <FiBookmark aria-hidden="true" /> <span className="truncate">{item.name}</span>
                </button>
                <button
                  className="hidden rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary group-hover:block"
                  aria-label={`Unpin ${item.name}`}
                  onClick={() => persistPinned(pinned.filter((pin) => pin.path !== item.path))}
                >
                  <FiX aria-hidden="true" />
                </button>
              </div>
            ))}
          </nav>

          <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-bg-hover pt-2">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Folders</div>
            <div className="min-h-0 flex-1 overflow-auto">
              <TreeRow entry={{ name: "Home", path: HOME_PATH, kind: "dir", size: 0, modified: "", permissions: "" }} depth={0} showHidden={showHidden} onOpen={(target) => { setPath(target); setSelectedPath(null); setPreview(null); }} />
            </div>
          </div>
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col" onContextMenu={(event) => showMenu(event, null)} onClick={() => setMenu(null)}>
        <div className="flex min-h-9 items-center gap-1 border-b border-bg-hover bg-bg-elevated px-2">
          <button className="mr-1 rounded p-1.5 text-text-secondary hover:bg-bg-hover" aria-label={showSidebar ? "Hide sidebar" : "Show sidebar"} onClick={() => setShowSidebar((value) => !value)}>
            <FiChevronDown className={showSidebar ? "" : "-rotate-90"} aria-hidden="true" />
          </button>
          {editingPath ? (
            <input
              autoFocus
              aria-label="Folder path"
              className="min-w-0 flex-1 rounded-card border border-accent/50 bg-bg-surface px-2 py-1 text-text-primary outline-none"
              value={pathInput}
              onBlur={submitPath}
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitPath();
                if (event.key === "Escape") {
                  setPathInput(path);
                  setEditingPath(false);
                }
              }}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1" onDoubleClick={() => setEditingPath(true)}>
              {breadcrumbs(path).map((crumb, index) => (
                <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <span className="text-text-disabled">/</span>}
                  <button className={`truncate rounded px-1 py-1 hover:bg-bg-hover ${index === breadcrumbs(path).length - 1 ? "text-text-primary" : "text-text-tertiary"}`} onClick={() => setPath(crumb.path)}>{crumb.label}</button>
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button className={`rounded p-1.5 ${view === "list" ? "bg-accent-bg text-accent" : "text-text-tertiary hover:bg-bg-hover"}`} aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><FiList aria-hidden="true" /></button>
            <button className={`rounded p-1.5 ${view === "icons" ? "bg-accent-bg text-accent" : "text-text-tertiary hover:bg-bg-hover"}`} aria-label="Icon view" aria-pressed={view === "icons"} onClick={() => setView("icons")}><FiGrid aria-hidden="true" /></button>
          </div>
        </div>

        {loadState === "loading" && <div className="space-y-2 p-3" aria-label="Loading folder" aria-busy="true">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-7 rounded bg-bg-hover/60 animate-pulse" />)}</div>}
        {loadState === "error" && !entries.length && <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><FiFolder className="h-9 w-9 text-status-danger" aria-hidden="true" /><p className="font-medium text-text-primary">This folder is unavailable</p><button className="rounded-card bg-bg-hover px-3 py-1.5 text-text-secondary hover:bg-bg-hover/80" onClick={() => setPath(parentPath(path))}>Go to parent folder</button></div>}
        {loadState === "empty" && <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><FiFolder className="h-10 w-10 text-text-tertiary" aria-hidden="true" /><p className="font-medium text-text-primary">This folder is empty</p><button className="rounded-card bg-accent px-3 py-1.5 font-medium text-bg-base hover:bg-accent-strong" onClick={newFolder}>New Folder</button></div>}
        {loadState === "populated" && (view === "list" ? (
          <div className="min-h-0 flex-1 overflow-auto" role="grid" aria-label="Files">
            <div className="grid grid-cols-[minmax(0,1fr)_72px_84px_60px] gap-2 border-b border-bg-hover px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
              {(["name", "size", "modified", "kind"] as const).map((key) => <button key={key} className="text-left hover:text-text-primary" onClick={() => toggleSort(key)}>{key}{sortKey === key && (sortAscending ? " ↑" : " ↓")}</button>)}
            </div>
             {sortedEntries.map((entry) => <button key={entry.path} className={`grid w-full grid-cols-[minmax(0,1fr)_72px_84px_60px] items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover/60 ${selectedPath === entry.path ? "bg-accent-bg" : ""}`} onClick={() => void selectEntry(entry)} onDoubleClick={() => activate(entry)} onContextMenu={(event) => showMenu(event, entry)}>
              <span className="flex min-w-0 items-center gap-2"><span className="shrink-0">{entryIcon(entry)}</span><span className="truncate text-text-primary">{entry.name}</span>{entry.kind === "symlink" && <span className="text-[10px] text-status-info">↗</span>}</span><span className="text-text-tertiary">{entry.kind === "dir" ? "—" : formatSize(entry.size)}</span><span className="text-text-tertiary">{formatModified(entry.modified)}</span><span className="text-text-tertiary">{entry.kind}</span>
            </button>)}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(92px,1fr))] content-start gap-2 overflow-auto p-3" role="grid" aria-label="Files">
             {sortedEntries.map((entry) => <button key={entry.path} className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-card p-2 text-center hover:bg-bg-hover/60 ${selectedPath === entry.path ? "bg-accent-bg" : ""}`} onClick={() => void selectEntry(entry)} onDoubleClick={() => activate(entry)} onContextMenu={(event) => showMenu(event, entry)}><span className="text-2xl">{entryIcon(entry)}</span><span className="max-w-full truncate text-text-primary">{entry.name}</span></button>)}
          </div>
        ))}

        <div className="flex min-h-8 items-center gap-2 border-t border-bg-hover bg-bg-elevated px-2">
          <span className="ml-auto text-[10px] text-text-tertiary">{sortedEntries.length} {sortedEntries.length === 1 ? "item" : "items"}{!showHidden && entries.length !== sortedEntries.length ? ` · ${entries.length - sortedEntries.length} hidden` : ""}</span>
        </div>
      </section>

      {menu && createPortal(
        <div ref={menuRef} className="fixed z-[100] min-w-44 rounded-card border border-bg-hover bg-bg-elevated p-1 font-sans shadow-xl" style={{ left: menuPos.left, top: menuPos.top }} onMouseDown={(event) => event.stopPropagation()}>
          {menu.entry?.kind === "file" && <>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { openEditor(menu.entry?.path ?? ""); setMenu(null); }}><FiEdit3 aria-hidden="true" /> Open in Editor</button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { openTerminal(parentPath(menu.entry?.path ?? path)); setMenu(null); }}><FiTerminal aria-hidden="true" /> Open in Terminal</button>
            {/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(menu.entry?.name ?? "") && (
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { openGallery(parentPath(menu.entry?.path ?? path)); setMenu(null); }}><FiImage aria-hidden="true" /> Open in Gallery</button>
            )}
          </>}
          {menu.entry?.kind === "dir" && <>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { setPath(menu.entry?.path ?? path); setMenu(null); }}><FiFolder aria-hidden="true" /> Open folder</button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { openGallery(menu.entry?.path ?? path); setMenu(null); }}><FiImage aria-hidden="true" /> Open in Gallery</button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { pinSelected(); setMenu(null); }}><FiBookmark aria-hidden="true" /> Add to Sidebar</button>
          </>}
          {menu.entry && <>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { renameSelected(); setMenu(null); }}><FiEdit3 aria-hidden="true" /> Rename</button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-status-danger hover:bg-bg-hover" onClick={() => { remove(); setMenu(null); }}><FiTrash2 aria-hidden="true" /> Delete</button>
          </>}
          {!menu.entry && <>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { newFile(); setMenu(null); }}><FiFile aria-hidden="true" /> New file</button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-primary hover:bg-bg-hover" onClick={() => { newFolder(); setMenu(null); }}><FiFolder aria-hidden="true" /> New folder</button>
          </>}
        </div>,
        document.body,
      )}

      {showPreview && (
        <aside className="relative flex shrink-0 flex-col border-l border-bg-hover bg-bg-overlay/30" style={{ width: previewWidth }} aria-label="Quick Look preview">
          <div ref={previewRef} className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize" role="separator" aria-orientation="vertical" aria-label="Resize preview" />
          <div className="flex min-h-9 items-center justify-between border-b border-bg-hover px-3"><span className="truncate font-medium text-text-primary">{preview?.entry.name ?? "Quick Look"}</span><button className="rounded p-1 text-text-tertiary hover:bg-bg-hover" aria-label="Close preview" onClick={() => setShowPreview(false)}><FiX aria-hidden="true" /></button></div>
          {!preview && <div className="flex flex-1 items-center justify-center p-4 text-center text-text-tertiary">Select a file to preview.</div>}
          {preview && <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="mb-3 flex items-center gap-2 text-[11px] text-text-secondary">{entryIcon(preview.entry)}<span>{formatSize(preview.entry.size)} · {preview.entry.kind}</span></div>
            {preview.error && <div className="rounded-card border-l-2 border-status-warning bg-status-warning/10 p-2 text-[11px] text-text-secondary">{preview.error}</div>}
            {!preview.error && isImage(preview.entry) && preview.encoding === "base64" && preview.content !== undefined && (
              <img
                src={`data:image/${preview.entry.name.split(".").pop()?.toLowerCase() ?? "" };base64,${preview.content}`}
                alt={preview.entry.name}
                className="mx-auto max-h-full max-w-full object-contain"
              />
            )}
            {!preview.error && !isImage(preview.entry) && preview.content !== undefined && <pre className="whitespace-pre-wrap break-words rounded-card bg-bg-surface p-2 font-mono text-[11px] leading-relaxed text-text-secondary">{preview.content}</pre>}
            {!preview.error && preview.content === undefined && <div className="flex flex-col items-center gap-2 py-8 text-center text-text-tertiary"><FiFile className="h-8 w-8" aria-hidden="true" /><span>Preview not available for this file type.</span></div>}
          </div>}
        </aside>
      )}
    </div>
  );
}
