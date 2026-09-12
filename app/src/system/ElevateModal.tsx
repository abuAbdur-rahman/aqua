import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FiLoader, FiLock } from "react-icons/fi";
import { elevate } from "../lib/api";
import { useModalStore } from "./modalStore";
import { useModalBehavior } from "./useModalBehavior";

export function ElevateModal() {
  const request = useModalStore((s) => s.elevate);
  const closeElevate = useModalStore((s) => s.closeElevate);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeCount, setShakeCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useModalBehavior(request != null && !submitting, panelRef, closeElevate, passwordRef);

  const open = request != null;
  const reset = () => {
    setPassword("");
    setSubmitting(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || submitting || password.length === 0) return;
    setSubmitting(true);
    // The password leaves React state the moment the request fires — it is
    // never retained for a retry payload or logged.
    const submitted = password;
    setPassword("");
    try {
      const result = await elevate(submitted);
      if (result.success) {
        closeElevate();
        reset();
        request.onSuccess();
      } else {
        setError("Wrong password.");
        setShakeCount((c) => c + 1);
        setSubmitting(false);
        passwordRef.current?.focus();
      }
    } catch {
      setError("Couldn't reach the daemon.");
      setSubmitting(false);
      passwordRef.current?.focus();
    }
  };

  return (
    <AnimatePresence onExitComplete={reset}>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-bg-base/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
        >
          <motion.div
            key={shakeCount}
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={`${request.appName} wants to make changes`}
            initial={shakeCount > 0 ? { opacity: 1, x: [-8, 8, -6, 6, -3, 3, 0] } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={
              shakeCount > 0
                ? { duration: 0.24, ease: "linear" }
                : { duration: 0.14, ease: [0.4, 0, 0.2, 1] }
            }
            className="w-full max-w-[380px]"
            style={{ willChange: "transform, opacity" }}
          >
            <form onSubmit={onSubmit}>
              <div className="rounded-[10px] border border-bg-hover bg-bg-overlay p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                <div className="flex items-start gap-3">
                  <FiLock className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" aria-hidden="true" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-text-primary">{request.appName} wants to make changes</h2>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{request.detail}</p>
                    {request.userName && (
                      <p className="mt-3 text-xs text-text-secondary">
                        User: <span className="font-medium text-text-primary">{request.userName}</span>
                      </p>
                    )}
                  </div>
                </div>
                <label htmlFor="elevate-password" className="sr-only">
                  Password
                </label>
                <input
                  id="elevate-password"
                  ref={passwordRef}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className={`mt-4 w-full rounded-card bg-bg-hover px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                    error && !submitting ? "border border-status-danger" : ""
                  }`}
                />
                {error && !submitting && <p className="mt-1.5 text-[11px] text-status-danger">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closeElevate();
                    }}
                    disabled={submitting}
                    className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || password.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <FiLoader className="h-3 w-3 animate-spin" aria-hidden="true" />
                        Authenticating…
                      </>
                    ) : (
                      "Authenticate"
                    )}
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
