import { useEffect, useState } from "react";
import { connectSysmon, type SysmonStats, type DiskStat } from "../../lib/sysmon";
import type { WidgetSize } from "./widgetLayout";

function DiskRow({ disk }: { disk: DiskStat }) {
  const pct = disk.total ? Math.min(100, (disk.used / disk.total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="truncate text-text-secondary">{disk.mount}</span>
        <span className="tabular-nums text-text-tertiary">{Math.round(pct)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-hover">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function StorageWidget({ size }: { size: WidgetSize }) {
  const [stats, setStats] = useState<SysmonStats | null>(null);
  useEffect(() => connectSysmon({ onStats: setStats, onDisconnect: () => {} }), []);
  const disks = stats?.disks ?? [];
  const visible = size === "small" ? disks.slice(0, 1) : disks.slice(0, 2);
  const more = disks.length - visible.length;
  if (!disks.length) return <div className="flex h-full items-center justify-center p-4 text-xs text-text-tertiary">No disks</div>;
  return (
    <div className="flex h-full flex-col p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">Storage</p>
      <div className="mt-2.5 space-y-2.5">
        {visible.map((d) => <DiskRow key={d.mount} disk={d} />)}
      </div>
      {more > 0 && <p className="mt-auto text-[11px] text-text-tertiary">+{more} more volume{more === 1 ? "" : "s"}</p>}
    </div>
  );
}
