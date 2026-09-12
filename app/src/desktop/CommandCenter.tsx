import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiTerminal } from "react-icons/fi";
import { useWindowStore } from "../windows/store";
import {
  buildCommands,
  groupCommands,
  matchesQuery,
  type CommandEntry,
} from "./commandRegistry";

interface CommandCenterProps {
  open: boolean;
  onClose: () => void;
  onOpenMissionControl: () => void;
  onToggleSpotlight: () => void;
}

export function CommandCenter({
  open,
  onClose,
  onOpenMissionControl,
  onToggleSpotlight,
}: CommandCenterProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  // id of the entry whose execution failed + why; the row shows an inline note
  // and the palette stays open so it's visible nothing happened (UI-SPEC-14 §4).
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    setQuery("");
    setSelected(0);
    setFailure(null);
  }, [open]);

  // Rebuilt on every open so closures read live store state when executed.
  const entries = useMemo<CommandEntry[]>(() => {
    if (!open) return [];
    const store = useWindowStore.getState();
    const focused =
      store.focusedId != null ? store.windows.find((w) => w.id === store.focusedId) : undefined;
    return buildCommands({
      appId: focused?.appId ?? null,
      focusedId: store.focusedId,
      onMissionControl: onOpenMissionControl,
      onToggleSpotlight,
      reportError: (id, message) => setFailure({ id, message }),
    });
  }, [open, onOpenMissionControl, onToggleSpotlight]);

  const filtered = useMemo(() => entries.filter((e) => matchesQuery(e, query)), [entries, query]);
  const groups = useMemo(() => groupCommands(filtered), [filtered]);

  useEffect(() => {
    setSelected(0);
    setFailure(null);
  }, [query]);

  if (!open) return null;

  const runEntry = (entry: CommandEntry) => {
    try {
      entry.run();
      onClose();
    } catch (err) {
      reportErrorInline(entry.id, err instanceof Error ? err.message : String(err));
    }
  };

  function reportErrorInline(id: string, message: string) {
    setFailure({ id, message });
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (e.key === "Enter" && filtered[selected]) {
      e.preventDefault();
      runEntry(filtered[selected]);
    }
  };

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12%]"
      onMouseDown={onClose}
      role="presentation"
    >
      <AnimatePresence>
        <motion.div
          key="command-center-panel"
          role="dialog"
          aria-label="Command Center"
          onMouseDown={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }}
          style={{ willChange: "transform, opacity" }}
          className="w-[560px] max-w-[92%] overflow-hidden rounded-window border border-bg-hover bg-bg-overlay shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-center gap-2 border-b border-bg-hover px-3 py-2">
            <FiTerminal className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={groups.length > 0}
              aria-controls="command-center-results"
              aria-label="Search commands"
              placeholder="Run a command"
              className="input-bare flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary"
            />
            <kbd className="rounded border border-bg-hover px-1 py-0.5 text-[10px] text-text-tertiary">Esc</kbd>
          </div>

          {groups.length > 0 ? (
            <div
              id="command-center-results"
              role="listbox"
              aria-label="Command results"
              className="max-h-[320px] overflow-auto p-2"
            >
              {groups.map((group) => (
                <div key={group.category}>
                  <p className="px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary [&:not(:first-child)]:mt-2">
                    {group.label.toUpperCase()}
                  </p>
                  {group.entries.map((entry) => {
                    flatIndex += 1;
                    const mine = flatIndex;
                    return (
                      <div key={entry.id}>
                        <div
                          role="option"
                          aria-selected={mine === selected}
                          aria-disabled={!entry.enabled}
                          onMouseEnter={() => entry.enabled && setSelected(mine)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            if (entry.enabled) runEntry(entry);
                          }}
                          className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs ${
                            mine === selected
                              ? "bg-accent-bg text-text-primary"
                              : "text-text-secondary"
                          } ${entry.enabled ? "cursor-default" : "cursor-default opacity-50"} ${
                            failure?.id === entry.id ? "rounded-b-none" : ""
                          }`}
                        >
                          <span className="truncate">{entry.label}</span>
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            <span className="rounded bg-bg-elevated px-1 py-0.5 text-[9px] uppercase tracking-wide text-text-tertiary">
                              {entry.category === "space" ? "spaces" : entry.category}
                            </span>
                            {entry.shortcutHint != null && (
                              <kbd className="rounded border border-bg-hover px-1 py-0.5 text-[10px] text-text-tertiary">
                                {entry.shortcutHint}
                              </kbd>
                            )}
                          </span>
                        </div>
                        {failure?.id === entry.id && (
                          <p
                            className="border-x border-b border-bg-hover bg-bg-overlay px-2 pb-1.5 pt-0.5 text-xs text-status-danger"
                            role="alert"
                          >
                            {failure.message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4">
              <p className="text-center text-xs text-text-secondary">No matching commands</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
