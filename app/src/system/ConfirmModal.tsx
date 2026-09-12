import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useModalStore } from "./modalStore";
import { useModalBehavior } from "./useModalBehavior";

export function ConfirmModal() {
  const confirm = useModalStore((s) => s.confirm);
  const closeConfirm = useModalStore((s) => s.closeConfirm);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useModalBehavior(confirm != null, panelRef, closeConfirm, cancelRef);

  // Enter activates the affirmative action only for the non-danger variant;
  // danger confirmations require an explicit click or Tab-to-button.
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const onButton = e.target instanceof HTMLElement && e.target.tagName === "BUTTON";
    if (onButton) return;
    e.preventDefault();
    if (!confirm?.danger) {
      confirm?.onConfirm();
      closeConfirm();
    }
  };

  return (
    <AnimatePresence>
      {confirm && (
        <motion.div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-bg-base/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={confirm.title}
            onKeyDown={onPanelKeyDown}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="w-full max-w-[380px] rounded-[10px] border border-bg-hover bg-bg-overlay p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
            style={{ willChange: "transform, opacity" }}
          >
            <h2 className="text-sm font-semibold text-text-primary">{confirm.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{confirm.body}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={closeConfirm}
                className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirm.onConfirm();
                  closeConfirm();
                }}
                className={`rounded-card px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${
                  confirm.danger
                    ? "bg-status-danger text-white hover:bg-status-danger/85"
                    : "bg-accent text-bg-base hover:bg-accent-strong"
                }`}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
