import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiFile, FiSearch } from "react-icons/fi";
import { LuCalculator, LuArrowLeftRight } from "react-icons/lu";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";
import {
  flattenResults,
  parentDir,
  search,
  SEARCH_DEBOUNCE_MS,
  type SearchResponse,
  type SpotlightItem,
} from "../lib/search";

type Status = "idle" | "loading" | "ready" | "error";

function appIconFor(id: string, name: string): string | null {
  const key = Object.keys(appManifest).find(
    (k) => k === id.toLowerCase() || appManifest[k].name.toLowerCase() === name.toLowerCase(),
  );
  return key ? appManifest[key].icon : null;
}

export function SpotlightPane({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    setResults(null);
    setStatus("idle");
    setSelected(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      requestRef.current += 1;
      setResults(null);
      setStatus("idle");
      setSelected(0);
      return;
    }
    setStatus("loading");
    const id = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      try {
        const res = await search(trimmed);
        if (requestRef.current !== id) return;
        setResults(res);
        setSelected(0);
        setStatus("ready");
      } catch {
        if (requestRef.current !== id) return;
        setStatus("error");
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  const items: SpotlightItem[] = results ? flattenResults(results) : [];
  const showLoadingDim = status === "loading" && items.length > 0;

  const runItem = (item: SpotlightItem) => {
    const store = useWindowStore.getState();
    if (item.kind === "app") {
      const icon = appIconFor(item.hit.id, item.hit.name);
      const key =
        icon &&
        Object.keys(appManifest).find((k) => appManifest[k].icon === icon);
      if (key) {
        store.openApp(key);
        onClose();
      }
      return;
    }
    if (item.kind === "file") {
      store.openFinder(parentDir(item.hit.path));
      onClose();
      return;
    }
    navigator.clipboard.writeText(item.hit.result).catch(() => {});
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, items.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (e.key === "Enter" && items[selected]) {
      e.preventDefault();
      runItem(items[selected]);
    }
  };

  let flatIndex = -1;
  const rowClass = (mine: number) =>
    `flex w-full items-center gap-2 px-2 py-1.5 text-xs ${mine === selected ? "bg-accent-bg text-text-primary" : "text-text-secondary"}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12%]"
      onMouseDown={onClose}
      role="presentation"
    >
      <AnimatePresence>
        <motion.div
          key="spotlight-panel"
          role="dialog"
          aria-label="Spotlight"
          onMouseDown={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }}
          style={{ willChange: "transform, opacity" }}
          className="w-[560px] max-w-[92%] overflow-hidden rounded-window border border-bg-hover bg-bg-overlay shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center gap-2 border-b border-bg-hover px-3 py-2">
            <FiSearch className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls="spotlight-results"
              aria-label="Search files, apps, or type a calculation"
              placeholder="Search files, apps, or type a calculation"
              className="input-bare flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {(items.length > 0 || status === "loading" || status === "error") && (
            <div
              id="spotlight-results"
              role="listbox"
              aria-label="Spotlight results"
              className={`max-h-[320px] overflow-auto p-2 ${showLoadingDim ? "opacity-50" : ""}`}
            >
              {status === "error" && (
                <p className="px-2 py-1.5 text-xs text-status-danger" role="alert">
                  Search is unavailable right now
                </p>
              )}

              {items.length > 0 && (
                <>
                  {results && results.apps.length > 0 && (
                    <>
                      <p className="px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary">APPS</p>
                      {results.apps.map((hit) => {
                        flatIndex += 1;
                        const mine = flatIndex;
                        const icon = appIconFor(hit.id, hit.name);
                        return (
                          <div
                            key={`app-${hit.id}`}
                            role="option"
                            aria-selected={mine === selected}
                            onMouseEnter={() => setSelected(mine)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              runItem(items[mine]);
                            }}
                            className={`${rowClass(mine)} cursor-default`}
                          >
                            {icon ? (
                              <img src={icon} alt="" className="h-3.5 w-3.5 object-contain" aria-hidden="true" />
                            ) : (
                              <FiFile className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{hit.name}</span>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {results && results.files.length > 0 && (
                    <>
                      <p className="mt-2 px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary">FILES</p>
                      {results.files.map((hit) => {
                        flatIndex += 1;
                        const mine = flatIndex;
                        const parent = parentDir(hit.path);
                        return (
                          <div
                            key={`file-${hit.path}`}
                            role="option"
                            aria-selected={mine === selected}
                            onMouseEnter={() => setSelected(mine)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              runItem(items[mine]);
                            }}
                            className={`${rowClass(mine)} cursor-default`}
                          >
                            <FiFile className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="shrink-0 truncate">{hit.name}</span>
                            <span className="truncate text-text-tertiary">{parent}</span>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {results && results.actions.length > 0 && (
                    <>
                      <p className="mt-2 px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary">
                        QUICK ACTIONS
                      </p>
                      {results.actions.map((hit) => {
                        flatIndex += 1;
                        const mine = flatIndex;
                        return (
                          <div
                            key={`action-${hit.input}-${mine}`}
                            role="option"
                            aria-selected={mine === selected}
                            onMouseEnter={() => setSelected(mine)}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              runItem(items[mine]);
                            }}
                            className={`${rowClass(mine)} cursor-default`}
                          >
                            {hit.kind === "calculator" ? (
                              <LuCalculator className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <LuArrowLeftRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">{hit.input}</span>
                            <span className="text-text-tertiary">→</span>
                            <span className="truncate">{hit.result}</span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {status === "ready" && items.length === 0 && (
            <div className="p-4">
              <p className="text-center text-xs text-text-secondary">No matches for “{query.trim()}”</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
