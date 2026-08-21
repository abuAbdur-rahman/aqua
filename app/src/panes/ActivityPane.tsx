export function ActivityPane({ state = "populated" as "loading" | "populated" | "disconnected" }) {
  if (state === "loading") {
    return (
      <div className="grid h-full grid-rows-[auto_1fr] gap-3 p-3">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-card bg-bg-hover/60 animate-pulse" />)}
        </div>
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 rounded bg-bg-hover/40 animate-pulse" />)}</div>
      </div>
    );
  }
  if (state === "disconnected") {
    return (
      <div className="p-3 opacity-60">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-card bg-bg-elevated p-3"><p className="text-lg font-semibold text-text-primary">42%</p><p className="text-[11px] text-text-tertiary">CPU — Last updated 4s ago</p></div>
          <div className="rounded-card bg-bg-elevated p-3"><p className="text-sm text-text-primary">6.1 / 16 GB</p><div className="mt-2 h-1.5 rounded bg-bg-hover"><div className="h-full w-2/5 rounded bg-accent" /></div></div>
          <div className="rounded-card bg-bg-elevated p-3"><p className="text-sm text-text-primary">212 / 512 GB</p><div className="mt-2 h-1.5 rounded bg-bg-hover"><div className="h-full w-1/3 rounded bg-accent" /></div></div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-card bg-bg-elevated p-3">
          <p className="text-lg font-semibold leading-none text-text-primary">42%</p>
          <p className="mt-1 text-[11px] text-text-tertiary">CPU</p>
          <div className="mt-2 flex items-end gap-px h-6">
            { [2,4,6,8,6,4,3,2,4,6].map((v,i)=><div key={i} className="flex-1 rounded-sm bg-accent" style={{ height: `${v*6}px`, opacity: 0.7+v/20 }} />)}
          </div>
        </div>
        <div className="rounded-card bg-bg-elevated p-3">
          <p className="text-sm font-medium text-text-primary">6.1 / 16 GB</p>
          <p className="text-[11px] text-text-tertiary">Memory</p>
          <div className="mt-2 h-1.5 rounded bg-bg-hover"><div className="h-full rounded bg-accent" style={{ width: "38%" }} /></div>
        </div>
        <div className="rounded-card bg-bg-elevated p-3">
          <p className="text-sm font-medium text-text-primary">212 / 512 GB</p>
          <p className="text-[11px] text-text-tertiary">Disk /</p>
          <div className="mt-2 h-1.5 rounded bg-bg-hover"><div className="h-full rounded bg-accent" style={{ width: "41%" }} /></div>
        </div>
      </div>
      <div className="flex-1 overflow-auto rounded-card border border-bg-hover">
        <div className="grid grid-cols-[1fr_80px_90px] gap-2 border-b border-bg-hover bg-bg-elevated px-3 py-1.5 text-[11px] font-medium text-text-tertiary">
          <span>Process</span><span>CPU%</span><span>Memory</span>
        </div>
        <div className="divide-y divide-bg-hover/40 text-xs">
          <div className="grid grid-cols-[1fr_80px_90px] px-3 py-1.5 hover:bg-bg-hover/30"><span>node (npm dev)</span><span>18.2%</span><span>340 MB</span></div>
          <div className="grid grid-cols-[1fr_80px_90px] px-3 py-1.5 hover:bg-bg-hover/30"><span>rust-analyzer</span><span>9.1%</span><span>612 MB</span></div>
          <div className="grid grid-cols-[1fr_80px_90px] px-3 py-1.5 hover:bg-bg-hover/30"><span>bash</span><span>0.1%</span><span>4 MB</span></div>
        </div>
      </div>
    </div>
  );
}
