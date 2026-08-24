import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useModalStore } from "./modalStore";
import { useModalBehavior } from "./useModalBehavior";

export function PromptModal() {
  const request = useModalStore((s) => s.prompt);
  const closePrompt = useModalStore((s) => s.closePrompt);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const open = request != null;
  useModalBehavior(open, panelRef, closePrompt, inputRef);
  useEffect(() => {
    if (request) setValue(request.initialValue ?? "");
  }, [open, request]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!request || trimmed.length === 0 || trimmed === (request.initialValue ?? "").trim()) return;
    closePrompt();
    request.onSubmit(trimmed);
  };

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
            className="w-full max-w-[380px]"
            style={{ willChange: "transform, opacity" }}
          >
            <form onSubmit={submit}>
              <div role="dialog" aria-modal="true" aria-label={request.title} className="rounded-[10px] border border-bg-hover bg-bg-overlay p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                <h2 className="text-sm font-semibold text-text-primary">{request.title}</h2>
                <label htmlFor="system-prompt-input" className="mt-3 block text-xs text-text-secondary">
                  {request.label ?? "Name"}
                </label>
                <input
                  id="system-prompt-input"
                  ref={inputRef}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onFocus={(e) => {
                    const dot = e.currentTarget.value.lastIndexOf(".");
                    e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded-card bg-bg-hover px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                />
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closePrompt}
                    className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={value.trim().length === 0}
                    className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
                  >
                    {request.submitLabel ?? "OK"}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
