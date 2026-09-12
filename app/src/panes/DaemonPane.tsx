import { useEffect, useState } from "react";
import { checkHealth } from "../lib/api";
import { toast } from "../system/toast";
import { useModalStore } from "../system/modalStore";
import { tauriInvoke, tauriInvokeStrict } from "../system/tauri";

interface DaemonPaneProps {
  connected: boolean;
  version: string | null;
}

export function DaemonPane({ connected, version }: DaemonPaneProps) {
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const [distro, setDistro] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [restartingDistro, setRestartingDistro] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void tauriInvoke<string>("get_distro").then((d) => {
      if (!cancelled) setDistro(typeof d === "string" ? d : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The pane polls health itself so version/status stay truthful while this
  // window stays open across daemon restarts.
  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    const id = window.setInterval(() => {
      checkHealth()
        .then(() => {
          if (!cancelled) setStale(false);
        })
        .catch(() => {
          if (!cancelled) setStale(true);
        });
    }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connected]);

  const onRestart = () => {
    if (connected) {
      requestConfirm({
        title: "Restart the daemon?",
        body: "Open terminal sessions will end.",
        confirmLabel: "Restart",
        danger: true,
        onConfirm: () => {
          void tauriInvoke("restart_daemon");
        },
      });
    } else {
      void tauriInvoke("restart_daemon");
    }
  };

  const stateLabel = stale ? "Reconnecting…" : connected ? "Connected" : "Offline";

  // Distro-scoped power action (app/PLAN.md §4): the modal copy names the real
  // distro resolved from `wsl -l -v`, never a hardcoded string. Disabled while
  // the daemon is unreachable — no point restarting something already down.
  const onRestartDistro = () => {
    if (!distro || !connected || stale || restartingDistro) return;
    requestConfirm({
      title: `Restart ${distro}?`,
      body: `This restarts the entire ${distro} WSL environment, not just Aqua's daemon — any other terminal, process, or tool currently running inside it will be stopped too. Aqua will reconnect automatically once it's back up.`,
      confirmLabel: `Restart ${distro}`,
      danger: true,
      onConfirm: () => {
        setRestartingDistro(true);
        toast.info(`Restarting ${distro} — this can take a moment…`);
        tauriInvokeStrict("restart_wsl_distro")
          .then(() => toast.success(`${distro} restarted`))
          .catch((e: unknown) =>
            toast.error(e instanceof Error ? e.message : `Failed to restart ${distro}`)
          )
          .finally(() => setRestartingDistro(false));
      },
    });
  };

  const distroButtonDisabled = !connected || stale || !distro || restartingDistro;

  return (
    <section aria-label="Daemon" className="max-w-md">
      <h2 className="text-sm font-semibold text-text-primary">Daemon</h2>
      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-secondary">Status</dt>
          <dd className="flex items-center gap-2 font-medium text-text-primary">
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected && !stale ? "bg-accent" : "bg-status-danger"}`}
              aria-hidden="true"
            />
            {stateLabel}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">Version</dt>
          <dd className="tabular-nums text-text-primary">{version ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-secondary">WSL distro</dt>
          <dd className="text-text-primary">{distro ?? "—"}</dd>
        </div>
      </dl>
      <button
        onClick={onRestart}
        className="mt-5 rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {connected ? "Restart Daemon" : "Start Daemon"}
      </button>

      <div className="mt-4 border-t border-bg-hover pt-4">
        <button
          onClick={onRestartDistro}
          disabled={distroButtonDisabled}
          title={distroButtonDisabled ? "Daemon must be running to restart it" : undefined}
          aria-disabled={distroButtonDisabled}
          className="rounded-card bg-status-danger/15 px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger/25 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
        >
          {restartingDistro ? "Restarting…" : "Restart WSL Distro"}
        </button>
        <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-text-tertiary">
          Restarts the whole {distro ?? "WSL"} environment — everything running inside it stops,
          not just Aqua's daemon.
        </p>
      </div>
    </section>
  );
}
