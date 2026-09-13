import { useEffect, useState } from "react";
import { checkHealth, getWslConf, putWslConf } from "../lib/api";
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
  const [sparse, setSparse] = useState(false);
  const [sparseBusy, setSparseBusy] = useState(false);
  const [conf, setConf] = useState<{ systemd: boolean; appendWindowsPath: boolean; automountEnabled: boolean; generateHosts: boolean } | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [confError, setConfError] = useState<string | null>(null);
  const [savingConf, setSavingConf] = useState(false);

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

  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    getWslConf()
      .then((c) => {
        if (cancelled) return;
        setConf({ systemd: c.systemd, appendWindowsPath: c.appendWindowsPath, automountEnabled: c.automountEnabled, generateHosts: c.generateHosts });
        setRaw(c.raw);
        setConfError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setConfError(e instanceof Error ? e.message : "Unable to load wsl.conf");
      });
    return () => {
      cancelled = true;
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

  const onToggleSparse = (next: boolean) => {
    if (!distro || sparseBusy) return;
    if (!next) {
      setSparse(false);
      return;
    }
    requestConfirm({
      title: `Enable Auto-Shrink for ${distro}?`,
      body: `This runs wsl --manage ${distro} --set-sparse true. It prevents future disk growth — existing bloat still requires stopping ${distro} once.`,
      confirmLabel: `Enable for ${distro}`,
      danger: true,
      onConfirm: () => {
        setSparseBusy(true);
        tauriInvokeStrict("set_sparse")
          .then(() => {
            setSparse(true);
            toast.success(`Auto-Shrink enabled for ${distro}`);
          })
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to enable Auto-Shrink"))
          .finally(() => setSparseBusy(false));
      },
    });
  };

  const onSaveConf = () => {
    if (!conf || savingConf) return;
    setSavingConf(true);
    putWslConf(conf)
      .then(() => toast.success("wsl.conf saved — takes effect on next WSL restart"))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save wsl.conf"))
      .finally(() => setSavingConf(false));
  };

  const toggleRow = (label: string, checked: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <div className="flex h-8 items-center justify-between gap-3">
      <span className="text-xs text-text-primary">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${checked ? "bg-accent" : "bg-bg-hover"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <section aria-label="Daemon" className="max-w-lg space-y-4">
      <h2 className="text-sm font-semibold text-text-primary">Daemon</h2>

      <div className="rounded-lg bg-bg-overlay p-4">
        <h3 className="text-xs font-semibold text-text-primary">WSL Lifecycle</h3>
        <dl className="mt-3 space-y-2 text-xs">
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
        <div className="mt-4 flex gap-2">
          <button
            onClick={onRestart}
            className="rounded-card bg-bg-hover px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-hover/70 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {connected ? "Restart Daemon" : "Start Daemon"}
          </button>
          <button
            onClick={onRestartDistro}
            disabled={distroButtonDisabled}
            title={distroButtonDisabled ? "Daemon must be running to restart it" : undefined}
            aria-disabled={distroButtonDisabled}
            className="rounded-card bg-status-danger/15 px-3 py-1.5 text-xs font-medium text-status-danger hover:bg-status-danger/25 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
          >
            {restartingDistro ? "Restarting…" : "Restart WSL Distro"}
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-bg-overlay p-4">
        <h3 className="text-xs font-semibold text-text-primary">Storage</h3>
        <div className="mt-2">
          {toggleRow("Enable Auto-Shrink", sparse, onToggleSparse, sparseBusy || !distro || !connected)}
        </div>
        <p className="mt-1 text-[13px] text-text-secondary">
          Prevents future disk growth. Existing bloat isn&apos;t reclaimed automatically — requires stopping {distro ?? "distro"} once.
        </p>
      </div>

      <div className="rounded-lg bg-bg-overlay p-4">
        <h3 className="text-xs font-semibold text-text-primary">wsl.conf</h3>
        {!connected ? (
          <p className="mt-2 text-xs text-text-tertiary">Daemon offline — wsl.conf unavailable.</p>
        ) : confError ? (
          <p className="mt-2 text-xs text-status-danger">{confError}</p>
        ) : !conf ? (
          <p className="mt-2 text-xs text-text-tertiary">Loading wsl.conf…</p>
        ) : (
          <div className="mt-2">
            {toggleRow("Enable systemd", conf.systemd, (v) => setConf({ ...conf, systemd: v }))}
            {toggleRow("Append Windows PATH", conf.appendWindowsPath, (v) => setConf({ ...conf, appendWindowsPath: v }))}
            {toggleRow("Auto-mount Windows drives", conf.automountEnabled, (v) => setConf({ ...conf, automountEnabled: v }))}
            {toggleRow("Generate /etc/hosts", conf.generateHosts, (v) => setConf({ ...conf, generateHosts: v }))}
          </div>
        )}
        {raw !== null && (
          <details className="mt-2 text-[13px] text-text-tertiary">
            <summary className="cursor-pointer">View raw file</summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg-base p-2 font-mono text-[12px] text-text-secondary">{raw}</pre>
          </details>
        )}
        <div className="mt-3 flex items-start justify-between gap-3">
          <p className="text-[12px] text-text-tertiary">Takes effect on next WSL restart.</p>
          <button
            onClick={onSaveConf}
            disabled={!conf || savingConf}
            className="rounded-card bg-accent px-3 py-1.5 text-xs font-semibold text-black hover:bg-accent-strong disabled:opacity-40"
          >
            {savingConf ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  );
}
