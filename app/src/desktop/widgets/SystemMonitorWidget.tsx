import { useEffect, useState } from "react";
import { connectSysmon, type SysmonStats } from "../../lib/sysmon";
import type { WidgetSize } from "./widgetLayout";

export function SystemMonitorWidget({ size }: { size: WidgetSize }) {
  const [stats, setStats] = useState<SysmonStats | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  useEffect(
    () =>
      connectSysmon({
        onStats: (s) => {
          setStats(s);
          setHistory((h) => [...h, s.cpuPercent].slice(-30));
        },
        onDisconnect: () => {},
      }),
    [],
  );
  if (!stats) return <div className="flex h-full items-center justify-center p-4 text-xs text-text-tertiary">Loading…</div>;
  const cpu = Math.round(stats.cpuPercent);
  const mem = Math.round((stats.memUsed / stats.memTotal) * 100);
  return (
    <div className="flex h-full flex-col p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">System</p>
      <div className="mt-2 flex items-end gap-6">
        <div>
          <p className="text-2xl font-semibold tabular-nums text-accent">{cpu}%</p>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">CPU</p>
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums text-accent">{mem}%</p>
          <p className="text-[10px] uppercase tracking-wider text-text-tertiary">MEM</p>
        </div>
      </div>
      {size === "medium" && (
        <div className="mt-auto">
          <svg viewBox="0 0 100 24" className="h-8 w-full text-accent" aria-hidden="true">
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
              points={history
                .map((v, i) => `${(i / (history.length - 1 || 1)) * 100},${24 - (v / 100) * 22}`)
                .join(" ")}
            />
          </svg>
          <p className="mt-1 text-right text-[10px] text-text-tertiary">CPU · last {history.length}s</p>
        </div>
      )}
    </div>
  );
}
