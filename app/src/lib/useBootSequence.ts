import { useCallback, useEffect, useState } from "react";
import { checkHealth, DAEMON_BASE } from "./api";
import { tauriInvoke } from "../system/tauri";

export type BootPhase = "checking" | "starting" | "waiting" | "success" | "failed";

// Mirrors the Tauri host's startup sequence (app/PLAN.md §4): one initial ping,
// then a ~200ms poll loop with ~5s timeout. The frontend can't observe the host
// spawning the daemon directly — a failed first ping implies it's happening.
export const POLL_INTERVAL_MS = 200;
export const POLL_TIMEOUT_MS = 5000;
const MAX_POLLS = Math.ceil(POLL_TIMEOUT_MS / POLL_INTERVAL_MS);
const STARTING_SWAP_POLLS = 8;

export interface BootSequence {
  phase: BootPhase;
  distro: string;
  healthUrl: string;
  retry: () => void;
}

export function useBootSequence(): BootSequence {
  const [phase, setPhase] = useState<BootPhase>("checking");
  const [distro, setDistro] = useState("WSL");
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    void tauriInvoke<string>("get_distro").then((d) => {
      if (!cancelled && typeof d === "string" && d.length > 0) setDistro(d);
    });

    let pollCount = 0;
    const poll = async () => {
      if (cancelled) return;
      pollCount += 1;
      try {
        await checkHealth();
        if (!cancelled) {
          if (pollTimer !== undefined) window.clearInterval(pollTimer);
          setPhase("success");
        }
        return;
      } catch {
        if (cancelled) return;
      }
      if (pollCount === STARTING_SWAP_POLLS) setPhase("waiting");
      if (pollCount >= MAX_POLLS) {
        if (pollTimer !== undefined) window.clearInterval(pollTimer);
        setPhase("failed");
      }
    };

    void (async () => {
      try {
        await checkHealth();
        if (!cancelled) setPhase("success");
      } catch {
        if (cancelled) return;
        setPhase("starting");
        pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
    };
  }, [runId]);

  const retry = useCallback(() => {
    setPhase("checking");
    setRunId((id) => id + 1);
  }, []);

  return { phase, distro, healthUrl: `${DAEMON_BASE}/api/health`, retry };
}
