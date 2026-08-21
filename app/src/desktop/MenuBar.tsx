interface MenuBarProps {
  daemonState: "connecting" | "connected" | "failed";
  daemonVersion: string | null;
  wsConnected: boolean;
}

export function MenuBar({ daemonState, daemonVersion, wsConnected }: MenuBarProps) {
  const statusMeta = {
    connecting: { color: "text-status-warning", dot: "bg-status-warning", text: "Daemon connecting…" },
    connected: { color: "text-status-success", dot: "bg-status-success", text: "Daemon connected" },
    failed: { color: "text-status-danger", dot: "bg-status-danger", text: "Daemon disconnected" },
  }[daemonState];

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center h-6 px-3 bg-bg-elevated border-b border-bg-hover select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      role="menubar"
      aria-label="Aqua menu bar"
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold tracking-tight text-text-primary">Aqua</span>
        {daemonVersion && (
          <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[11px] font-medium leading-none text-text-tertiary">
            v{daemonVersion}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 pr-1">
        <span className={`inline-flex items-center gap-1.5 text-xs ${statusMeta.color}`} role="status" aria-live="polite">
          {/* text + color, not color alone per Phase 0 */}
          <span className={`h-2 w-2 rounded-full ${statusMeta.dot} ${wsConnected && daemonState === "connected" ? "shadow-[0_0_6px_var(--status-success)]" : ""}`} aria-hidden="true" />
          {statusMeta.text}
          {daemonState === "connected" && !wsConnected && (
            <span className="text-text-tertiary">(WS offline)</span>
          )}
        </span>
        <span className="hidden sm:inline text-[11px] text-text-tertiary tabular-nums">
          {new Date().toLocaleDateString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}
