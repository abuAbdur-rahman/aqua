import { AnimatePresence, motion } from "framer-motion";
import { FiAlertTriangle, FiCheck } from "react-icons/fi";
import type { BootPhase } from "../lib/useBootSequence";

const CAPTIONS: Record<Exclude<BootPhase, "success" | "failed">, string> = {
  checking: "Checking for Aqua daemon…",
  starting: "Starting WSL…",
  waiting: "Waiting for daemon to respond…",
};

const FADE = { duration: 0.22, ease: [0.4, 0, 0.2, 1] as const };

interface GreeterProps {
  phase: BootPhase;
  distro: string;
  healthUrl: string;
  onRetry: () => void;
}

export function Greeter({ phase, distro, healthUrl, onRetry }: GreeterProps) {
  const failed = phase === "failed";
  const succeeded = phase === "success";

  return (
    <motion.div
      className="fixed inset-0 z-[2147483647] flex flex-col items-center justify-center gap-6 bg-bg-base"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={FADE}
      role="status"
      aria-live="polite"
    >
      <img
        src="/icons/aqua-logo.png"
        alt=""
        className="h-24 w-24 rounded-xl object-contain"
        aria-hidden="true"
      />

      {failed ? (
        <FiAlertTriangle className="h-6 w-6 text-status-warning" aria-hidden="true" />
      ) : succeeded ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          aria-hidden="true"
        >
          <FiCheck className="h-6 w-6 text-accent" />
        </motion.span>
      ) : (
        <div className="flex items-center gap-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-accent"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
            />
          ))}
        </div>
      )}

      {failed ? (
        <>
          <p className="text-sm text-text-primary">Aqua daemon isn't responding</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-bg-base hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-accent-ring focus-visible:outline-offset-2"
          >
            Retry
          </button>
          <p className="font-mono text-xs text-text-tertiary">
            wsl -d {distro} -- systemctl --user start aqua-daemon.service · {healthUrl}
          </p>
        </>
      ) : (
        <p className="text-sm text-text-secondary">
          {succeeded ? "Connected" : CAPTIONS[phase]}
        </p>
      )}
    </motion.div>
  );
}

// Mounted at the app root; stays rendered through the exit fade while the
// desktop mounts underneath (AnimatePresence handles the unmount).
export function GreeterHost(props: GreeterProps & { visible: boolean }) {
  return (
    <AnimatePresence>
      {props.visible && <Greeter {...props} />}
    </AnimatePresence>
  );
}
