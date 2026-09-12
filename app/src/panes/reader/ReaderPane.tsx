import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAlertCircle,
  FiBookOpen,
  FiClipboard,
  FiCopy,
  FiEdit3,
  FiFileText,
  FiFolder,
  FiPrinter,
  FiTrash2,
} from "react-icons/fi";
import {
  ApiError,
  copyPath,
  listDirectory,
  moveToTrash,
  NeedsElevationError,
  readFile,
  renameEntry,
  type FsWatchEvent,
} from "../../lib/filesystem";
import { useFsWatch } from "../../lib/useFsWatch";
import { markdownToPlainText, parseToc } from "../../lib/markdown";
import { PDF_PREVIEW_LIMIT_BYTES, readerKindForFile, type ReaderKind } from "../../lib/readerFiles";
import { MarkdownRenderer } from "../../components/MarkdownRenderer";
import { useModalStore } from "../../system/modalStore";
import { toast } from "../../system/toast";
import { useWindowStore } from "../../windows/store";
import { parentOf } from "../gallery/galleryUtils";
import { useReaderUiStore, type ReaderMenuAction } from "./readerStore";

type DocState = "loading" | "populated" | "error" | "removed";

const PdfRenderer = lazy(() => import("../../components/PdfRenderer"));

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// fs-watch lives in a child so the hook only subscribes once a file is open.
// The daemon watches directories (same as Finder/Gallery), so we watch the
// parent and filter events to the open file.
function ReaderLive({ path, onEvent }: { path: string; onEvent: (event: FsWatchEvent) => void }) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const onWatch = useCallback((event: FsWatchEvent) => handlerRef.current(event), []);
  useFsWatch(parentOf(path), onWatch);
  return null;
}

export function ReaderPane() {
  const readerPathRequest = useWindowStore((state) => state.readerPathRequest);
  const clearReaderPathRequest = useWindowStore((state) => state.clearReaderPathRequest);
  const openFinder = useWindowStore((state) => state.openFinder);
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const requestPrompt = useModalStore((s) => s.requestPrompt);
  const requestElevate = useModalStore((s) => s.requestElevate);
  const requestFilePicker = useModalStore((s) => s.requestFilePicker);
  const tocOpen = useReaderUiStore((s) => s.tocOpen);
  const setHasDocument = useReaderUiStore((s) => s.setHasDocument);

  const [path, setPath] = useState<string | null>(null);
  const [docState, setDocState] = useState<DocState>("removed");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<ReaderKind | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTocIndex, setActiveTocIndex] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<string | null>(null);
  const scrollRestoreRef = useRef<number | null>(null);
  const ignoreRemovalRef = useRef(false);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const ready = docState === "populated";
  const toc = useMemo(() => kind === "markdown" ? parseToc(content) : [], [content, kind]);
  const activeIndex = Math.min(activeTocIndex, Math.max(0, toc.length - 1));

  const pickFile = () => {
    requestFilePicker({
      mode: "open",
      title: "Open Document",
      submitLabel: "Open",
      onSubmit: (target) => void openDocument(target),
    });
  };

  const handleNeedsElevation = (cause: unknown, detail: string, retry: () => Promise<void>, fallback: string): boolean => {
    if (!(cause instanceof NeedsElevationError)) return false;
    requestElevate({
      appName: "Reader",
      detail: `${detail} requires your password.`,
      onSuccess: () => {
        void retry().catch((retryCause: unknown) =>
          toast.error(retryCause instanceof Error ? retryCause.message : fallback),
        );
      },
    });
    return true;
  };

  const openDocument = useCallback(async (target: string) => {
    setPath(target);
    setDocState("loading");
    setErrorMessage(null);
    const nextKind = readerKindForFile(target);
    setKind(nextKind);
    if (!nextKind) {
      setDocState("error");
      setErrorMessage("Reader supports Markdown and PDF files.");
      setHasDocument(false);
      return;
    }
    try {
      if (nextKind === "pdf") {
        const entries = await listDirectory(parentOf(target));
        const entry = entries.find((item) => item.path === target);
        if (entry && entry.size > PDF_PREVIEW_LIMIT_BYTES) {
          setDocState("error");
          setErrorMessage("This PDF is too large to preview (8 MB limit).");
          setHasDocument(false);
          return;
        }
      }
      const response = await readFile(target);
      if (nextKind === "pdf" && (response.encoding !== "base64" || response.truncated)) {
        setDocState("error");
        setErrorMessage(response.truncated ? "This PDF is too large to preview." : "The daemon didn't return PDF bytes.");
        setHasDocument(false);
        return;
      }
      if (nextKind === "markdown" && response.encoding !== "utf8") {
        setDocState("error");
        setErrorMessage("This Markdown file isn't UTF-8 text.");
        setHasDocument(false);
        return;
      }
      setContent(response.content);
      setDocState("populated");
      setHasDocument(true);
    } catch (cause: unknown) {
      setDocState("error");
      setErrorMessage(cause instanceof Error ? cause.message : "Unable to read this file");
      setHasDocument(false);
    }
  }, [setHasDocument]);

  // Silent in-place refresh on fs-watch: no skeleton flash, scroll preserved.
  const reloadDocument = useCallback(async () => {
    const target = pathRef.current;
    if (!target) return;
    scrollRestoreRef.current = scrollRef.current?.scrollTop ?? null;
    try {
      const response = await readFile(target);
      const currentKind = readerKindForFile(target);
      if ((currentKind === "markdown" && response.encoding === "utf8") || (currentKind === "pdf" && response.encoding === "base64" && !response.truncated)) {
        setContent(response.content);
        setDocState("populated");
        setHasDocument(true);
      }
    } catch {
      setDocState("removed");
      setHasDocument(false);
    }
  }, [setHasDocument]);

  // Restore the saved scroll position once the reloaded content has painted.
  useEffect(() => {
    if (scrollRestoreRef.current === null) return;
    const saved = scrollRestoreRef.current;
    scrollRestoreRef.current = null;
    const container = scrollRef.current;
    if (container) container.scrollTop = saved;
  }, [content]);

  useEffect(() => {
    if (!readerPathRequest) return;
    const target = readerPathRequest;
    clearReaderPathRequest();
    void openDocument(target);
  }, [clearReaderPathRequest, openDocument, readerPathRequest]);

  const onWatchEvent = useCallback(
    (event: FsWatchEvent) => {
      if (event.path !== pathRef.current) return;
      if (event.kind === "removed" || event.kind === "renamed") {
        if (ignoreRemovalRef.current) {
          ignoreRemovalRef.current = false;
          return;
        }
        setDocState("removed");
        setHasDocument(false);
        return;
      }
      if (event.kind === "modified") void reloadDocument();
    },
    [reloadDocument, setHasDocument],
  );

  // ---- file actions ---------------------------------------------------------

  const renameDocument = () => {
    const target = pathRef.current;
    if (!target) return;
    requestPrompt({
      title: "Rename",
      label: "New name",
      initialValue: basename(target),
      submitLabel: "Rename",
      onSubmit: (name) => {
        void renameEntry(target, name)
          .then(() => {
            // The rename event will follow on fs-watch; don't read it as a removal.
            ignoreRemovalRef.current = true;
            setPath(`${parentOf(target)}/${name}`);
            toast.success(`Renamed to “${name}”.`);
          })
          .catch((cause: unknown) => {
            if (handleNeedsElevation(cause, `rename ${target} → ${name}`, async () => { await renameEntry(target, name, true); }, "Couldn't rename file")) return;
            toast.error(cause instanceof ApiError && cause.status === 409 ? "That name is already in use" : cause instanceof Error ? cause.message : "Couldn't rename file");
          });
      },
    });
  };

  const duplicateDocument = async () => {
    const target = pathRef.current;
    if (!target) return;
    try {
      // copy with the parent as destination auto-renames on conflict (the same
      // daemon policy Trash restore and Windows import already rely on).
      await copyPath(target, parentOf(target));
      toast.success(`Duplicated “${basename(target)}”.`);
    } catch (cause: unknown) {
      if (handleNeedsElevation(cause, `duplicate ${target}`, async () => { await copyPath(target, parentOf(target), true); }, "Couldn't duplicate file")) return;
      toast.error(cause instanceof Error ? cause.message : "Couldn't duplicate file");
    }
  };

  const trashDocument = async () => {
    const target = pathRef.current;
    if (!target) return;
    const dispatch = () => {
      void moveToTrash(target)
        .then(() => {
          ignoreRemovalRef.current = true;
          setDocState("removed");
          setHasDocument(false);
          toast.success(`Moved “${basename(target)}” to Trash.`);
        })
        .catch((cause: unknown) => {
          if (handleNeedsElevation(cause, `moveToTrash ${target}`, async () => { await moveToTrash(target, true); }, "Couldn't move file to Trash")) return;
          toast.error(cause instanceof Error ? cause.message : "Couldn't move file to Trash");
        });
    };
    // Reader only has the path, not the entry's isTrashable flag — resolve it
    // from the parent listing so Windows-mount files get the irreversible modal.
    try {
      const entries = await listDirectory(parentOf(target));
      const entry = entries.find((item) => item.path === target);
      if (entry?.isTrashable) {
        dispatch();
        return;
      }
      requestConfirm({
        title: `Delete “${basename(target)}” permanently?`,
        body: `${target} is on a Windows mount and will be removed from disk. This can't be undone.`,
        confirmLabel: "Delete",
        danger: true,
        onConfirm: dispatch,
      });
    } catch {
      dispatch();
    }
  };

  const revealInFinder = () => {
    const target = pathRef.current;
    if (target) openFinder(parentOf(target));
  };

  const copyAsMarkdown = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Copied Markdown to clipboard.");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const copyAsPlainText = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(markdownToPlainText(content));
      toast.success("Copied plain text to clipboard.");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  const printDocument = () => window.print();

  const onScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
    let index = 0;
    for (let i = 0; i < headings.length; i += 1) {
      if (headings[i].getBoundingClientRect().top <= rect.top + 12) index = i;
    }
    setActiveTocIndex((current) => (current === index ? current : index));
  };

  const jumpToHeading = (index: number) => {
    const container = scrollRef.current;
    const heading = container?.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
    if (container && heading) container.scrollTo({ top: heading.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 12, behavior: "smooth" });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "c") {
      const selection = window.getSelection()?.toString() ?? "";
      if (selection) return; // let the browser copy the selection
      if (ready) {
        event.preventDefault();
        void copyAsPlainText();
      }
    } else if (key === "p") {
      if (ready) {
        event.preventDefault();
        printDocument();
      }
    } else if (key === "d") {
      if (ready) {
        event.preventDefault();
        void duplicateDocument();
      }
    } else if (event.key === "Delete") {
      if (ready) {
        event.preventDefault();
        void trashDocument();
      }
    }
  };

  // Menu-bar actions arrive over the shared CustomEvent channel (gallery pattern).
  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action: ReaderMenuAction }>).detail;
      if (!detail) return;
      switch (detail.action) {
        case "rename":
          renameDocument();
          break;
        case "duplicate":
          void duplicateDocument();
          break;
        case "moveToTrash":
          void trashDocument();
          break;
        case "revealInFinder":
          revealInFinder();
          break;
        case "copyAsMarkdown":
          void copyAsMarkdown();
          break;
        case "copyAsPlainText":
          void copyAsPlainText();
          break;
        case "toggleToc":
          useReaderUiStore.getState().toggleToc();
          break;
        case "print":
          printDocument();
          break;
      }
    };
    window.addEventListener("aqua-reader-action", onAction);
    return () => window.removeEventListener("aqua-reader-action", onAction);
  });

  const actionButton = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
    >
      {icon}
    </button>
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-bg-surface text-xs" tabIndex={0} onKeyDown={onKeyDown} aria-label="Reader">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-bg-hover bg-bg-elevated px-2">
        {kind === "markdown" && actionButton(
          tocOpen ? "Hide table of contents" : "Show table of contents",
          <FiBookOpen aria-hidden="true" />,
          () => useReaderUiStore.getState().toggleToc(),
        )}
        <span className="min-w-0 truncate font-medium text-text-primary">{path ? basename(path) : "Reader"}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {kind === "markdown" && actionButton("Copy as Markdown", <FiClipboard aria-hidden="true" />, () => void copyAsMarkdown(), !ready)}
          {kind === "markdown" && actionButton("Copy as Plain Text", <FiFileText aria-hidden="true" />, () => void copyAsPlainText(), !ready)}
          {kind === "markdown" && <div className="mx-1 h-4 w-px bg-bg-hover" aria-hidden="true" />}
          {actionButton("Rename", <FiEdit3 aria-hidden="true" />, renameDocument, !ready)}
          {actionButton("Duplicate", <FiCopy aria-hidden="true" />, () => void duplicateDocument(), !ready)}
          {actionButton("Reveal in Finder", <FiFolder aria-hidden="true" />, revealInFinder, !ready)}
          {actionButton("Move to Trash", <FiTrash2 aria-hidden="true" />, () => void trashDocument(), !ready)}
          {actionButton("Print", <FiPrinter aria-hidden="true" />, printDocument, !ready)}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {tocOpen && docState === "populated" && toc.length > 0 && (
          <aside className="flex w-52 shrink-0 flex-col border-r border-bg-hover bg-bg-elevated/60" aria-label="Table of contents">
            <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Contents</div>
            <nav className="min-h-0 flex-1 overflow-auto p-1.5">
              {toc.map((heading, index) => (
                <button
                  key={`${heading.level}-${heading.text}-${index}`}
                  className={`flex w-full items-center rounded px-2 py-1 text-left ${index === activeIndex ? "bg-accent-bg text-accent" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
                  style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
                  onClick={() => jumpToHeading(index)}
                >
                  <span className="truncate">{heading.text}</span>
                </button>
              ))}
            </nav>
          </aside>
        )}

        <main
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-auto bg-bg-surface"
          aria-label="Document"
        >
          {docState === "loading" && (
            <div className="space-y-3 p-6" aria-busy="true" aria-label="Loading document">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-3 animate-pulse rounded bg-bg-hover/50" style={{ width: `${50 + (index % 5) * 12}%` }} />
              ))}
            </div>
          )}

          {path == null && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FiFileText className="h-10 w-10 text-text-tertiary" aria-hidden="true" />
              <p className="font-medium text-text-primary">Open a document</p>
              <p className="max-w-xs text-[11px] leading-relaxed text-text-tertiary">
                Reader opens Markdown and PDF files in one focused document window.
              </p>
              <button
                className="rounded-card bg-accent px-3 py-1.5 font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent"
                onClick={pickFile}
              >
                Open a document…
              </button>
            </div>
          )}

          {docState === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FiAlertCircle className="h-9 w-9 text-status-danger" aria-hidden="true" />
              <p className="font-medium text-text-primary">This file can&apos;t be opened</p>
              {errorMessage && <p className="max-w-xs break-words font-mono text-[10px] text-text-tertiary">{errorMessage}</p>}
              <div className="flex gap-3">
                <button
                  className="rounded-card bg-bg-hover px-3 py-1.5 text-text-secondary hover:bg-bg-hover/80 focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => {
                    if (path) void openDocument(path);
                  }}
                >
                  Retry
                </button>
                <button className="rounded-card px-3 py-1.5 text-accent hover:bg-bg-hover" onClick={pickFile}>
                  Open another file
                </button>
              </div>
            </div>
          )}

          {docState === "removed" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FiAlertCircle className="h-9 w-9 text-status-warning" aria-hidden="true" />
              <p className="font-medium text-text-primary">This file was moved or deleted</p>
              <p className="max-w-xs text-[11px] leading-relaxed text-text-tertiary">
                It changed on disk while Reader had it open.
              </p>
              <button className="rounded-card px-3 py-1.5 text-accent hover:bg-bg-hover" onClick={pickFile}>
                Open another file
              </button>
            </div>
          )}

          {docState === "populated" && kind === "markdown" && (
            <MarkdownRenderer markdown={content} className="mx-auto max-w-3xl px-8 py-6" />
          )}
          {docState === "populated" && kind === "pdf" && (
            <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-bg-hover/50" aria-label="Loading PDF viewer" />}>
              <div className="min-h-full p-4"><PdfRenderer base64={content} /></div>
            </Suspense>
          )}
        </main>
      </div>

      {path != null && <ReaderLive path={path} onEvent={onWatchEvent} />}
    </div>
  );
}
