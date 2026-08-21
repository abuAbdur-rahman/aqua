import { MenuBar } from "./MenuBar";
import { Dock } from "./Dock";
import { useDaemonConnection } from "../lib/useDaemon";

export function Desktop() {
  const { state, version, wsConnected } = useDaemonConnection();

  return (
    <div className="fixed inset-0 bg-bg-base flex flex-col font-sans">
      <MenuBar daemonState={state} daemonVersion={version} wsConnected={wsConnected} />
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-bg-base to-[#0d1b1f]" />
      </div>
      <Dock />
    </div>
  );
}