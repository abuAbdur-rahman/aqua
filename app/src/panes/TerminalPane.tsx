type State = "spawning" | "connected" | "exited" | "disconnected";
export function TerminalPane({ state = "connected" as State }) {
  if (state === "spawning") {
    return <div className="flex h-full items-center justify-center p-4 text-xs text-text-tertiary">Starting shell…</div>;
  }
  if (state === "exited") {
    return (
      <div className="flex h-full flex-col bg-bg-surface p-2 font-mono text-xs">
        <div className="text-text-secondary">abdul@wsl:~/projects/aqua$ npm run dev</div>
        <div className="mt-2 text-text-tertiary">[Process exited with code <span className="text-status-danger">1</span>]</div>
        <button className="mt-2 self-start text-accent hover:text-accent-strong">Restart</button>
      </div>
    );
  }
  if (state === "disconnected") {
    return (
      <div className="relative flex h-full bg-bg-surface p-2 font-mono text-xs">
        <div className="opacity-60">abdul@wsl:~/projects/aqua$ ls</div>
        <div className="absolute inset-0 flex items-center justify-center bg-bg-overlay/60 text-xs text-text-secondary">Connection lost — reconnecting…</div>
      </div>
    );
  }
  // tab strip hidden when single tab per spec; show body with 8px padding
  return (
    <div className="flex h-full flex-col bg-bg-surface">
      <div className="flex-1 p-2 font-mono text-xs leading-relaxed" style={{ padding: 8 }}>
        <div className="text-text-secondary">abdul@wsl:~/projects/aqua$ ls</div>
        <div className="text-text-primary">AGENTS.md  CONTRACT.md  DESIGN.md  README.md</div>
        <div className="text-text-primary">abdul@wsl:~/projects/aqua$ <span className="inline-block h-3 w-2 bg-accent align-middle animate-pulse" aria-hidden="true" /></div>
      </div>
    </div>
  );
}
