import { MenuBar } from "./MenuBar";
import { Dock } from "./Dock";
import { WindowHost } from "../windows/WindowHost";
import { useDaemonConnection } from "../lib/useDaemon";

export function Desktop() {
  const { state, version, wsConnected } = useDaemonConnection();

  return (
    <div className="fixed inset-0 flex flex-col bg-bg-base font-sans overflow-hidden select-none">
      <MenuBar daemonState={state} daemonVersion={version} wsConnected={wsConnected} />

      {/* Reserve menu bar (24) + dock (64) so desktop never renders beneath */}
      <div className="flex-1 relative overflow-hidden pt-6 pb-16">
        {/* Wallpaper: bg-base -> desaturated deep teal per DESIGN.md */}
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(1200px 600px at 75% -10%, rgba(34,211,238,0.08), transparent 60%), linear-gradient(180deg, var(--bg-base) 0%, #0d1a1e 85%, #0a1418 100%)`,
          }}
          aria-hidden="true"
        />
        {/* Subtle grain/noise overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")` }} aria-hidden="true" />

        <WindowHost />
      </div>

      <Dock />
    </div>
  );
}
