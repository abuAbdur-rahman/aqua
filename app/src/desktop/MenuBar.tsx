interface MenuBarProps {
  daemonState: "connecting" | "connected" | "failed";
  daemonVersion: string | null;
  wsConnected: boolean;
}

export function MenuBar({ daemonState, daemonVersion, wsConnected }: MenuBarProps) {
  const statusColor = daemonState === "connected"
    ? "text-status-success"
    : daemonState === "connecting"
    ? "text-status-warning"
    : "text-status-danger";

  const statusText = daemonState === "connected"
    ? "Daemon connected"
    : daemonState === "connecting"
    ? "Daemon connecting..."
    : "Daemon connection failed";

  return (
    <div
      className="fixed top-0 left-0 right-0 h-[var(--height-menu-bar)] bg-bg-elevated border-b border-bg-hover flex items-center px-3 z-50 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-text-primary">Aqua</span>
        {daemonVersion && (
          <span className="text-xs text-text-tertiary px-1.5 py-0.5 rounded bg-bg-hover">
            v{daemonVersion}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4 pr-2">
        <span className={`text-xs ${statusColor} flex items-center gap-1`}>
          <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-status-success" : "bg-status-danger"}`} />
          {statusText}
        </span>
      </div>
    </div>
  );
}