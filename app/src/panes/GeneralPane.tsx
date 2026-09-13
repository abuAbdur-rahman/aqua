import { useDaemonConnection } from "../lib/useDaemon";

export function GeneralPane() {
  const { state, version } = useDaemonConnection();
  const connected = state === "connected";
  return (
    <section aria-label="General" className="max-w-md">
      <h2 className="text-sm font-semibold text-text-primary">General</h2>
      <p className="mt-2 text-xs text-text-secondary">Aqua is dark-mode only. A light theme isn&apos;t planned.</p>
      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-secondary">App version</dt>
          <dd className="text-text-primary">2.0.0</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-text-secondary">Daemon</dt>
          <dd className="flex items-center gap-2 font-medium text-text-primary">
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-status-success" : "bg-status-danger"}`}
              aria-hidden="true"
            />
            {connected ? `Connected${version ? ` · ${version}` : ""}` : "Disconnected"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
