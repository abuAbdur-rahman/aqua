import { useEffect, useMemo, useState } from "react";
import { FiHardDrive, FiDatabase, FiCpu } from "react-icons/fi";
import { connectSysmon, type DiskStat, type ProcessStat, type SysmonStats } from "../lib/sysmon";

type LoadState = "loading" | "populated" | "disconnected";
type SortKey = "name" | "cpuPercent" | "memBytes";
const MAX_HISTORY = 60;

function formatBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = -1;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function thresholdColor(value: number): string {
  if (value > 90) return "bg-status-danger";
  if (value >= 70) return "bg-status-warning";
  return "bg-accent";
}

function thresholdTextColor(value: number): string {
  if (value > 90) return "text-status-danger";
  if (value >= 70) return "text-status-warning";
  return "text-accent";
}

function elapsedSince(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  return `${seconds}s`;
}

function Sparkline({ values }: { values: number[] }) {
  const points = values.length > 1
    ? values.map((value, index) => `${(index / (values.length - 1)) * 100},${24 - (Math.min(100, value) / 100) * 22}`).join(" ")
    : "0,24 100,24";
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-7 w-full" aria-label="CPU history" role="img">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" className="stroke-current" strokeWidth="1.5" />
    </svg>
  );
}

function UsageBar({ value }: { value: number }) {
  return (
    <div className="mt-2 h-1.5 rounded-full bg-bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
      <div className={`h-full rounded-full ${thresholdColor(value)}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function StatCard({ label, icon, children, className = "" }: { label: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-card bg-bg-elevated p-3 ${className}`} aria-label={label}>
      <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">{icon}<span>{label}</span></div>
      {children}
    </section>
  );
}

function Skeleton() {
  return <div className="h-20 animate-pulse rounded-card bg-bg-hover/60" />;
}

function ProcessTable({ processes }: { processes: ProcessStat[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("cpuPercent");
  const [ascending, setAscending] = useState(false);
  const sorted = useMemo(() => [...processes].sort((left, right) => {
    const result = sortKey === "name" ? left.name.localeCompare(right.name) : left[sortKey] - right[sortKey];
    return ascending ? result : -result;
  }), [ascending, processes, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  };

  const heading = (key: SortKey, label: string) => (
    <button className="text-left hover:text-text-primary" onClick={() => toggleSort(key)} aria-label={`Sort by ${label}`}>
      {label}{sortKey === key ? (ascending ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-card border border-bg-hover" role="region" aria-label="Processes">
      <div className="grid grid-cols-[minmax(0,1fr)_72px_92px] gap-2 border-b border-bg-hover bg-bg-elevated px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        {heading("name", "Process")}{heading("cpuPercent", "CPU")}{heading("memBytes", "Memory")}
      </div>
      {sorted.length === 0 ? (
        <p className="p-6 text-center text-xs text-text-tertiary">No processes reported.</p>
      ) : (
        <div className="divide-y divide-bg-hover/40 text-xs" role="list">
          {sorted.map((process) => (
            <div key={process.pid} className="grid grid-cols-[minmax(0,1fr)_72px_92px] gap-2 px-3 py-1.5 hover:bg-bg-hover/30" role="listitem">
              <span className="min-w-0 truncate text-text-primary" title={process.name}>{process.name}</span>
              <span className={thresholdTextColor(Math.min(100, process.cpuPercent))}>{process.cpuPercent.toFixed(1)}%</span>
              <span className="text-text-secondary">{formatBytes(process.memBytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiskCards({ disks }: { disks: DiskStat[] }) {
  const items = disks.length ? disks : [{ mount: "No mount", used: 0, total: 0 }];
  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto">
      {items.map((disk) => {
        const usage = percent(disk.used, disk.total);
        return (
          <StatCard key={disk.mount} label={`Disk ${disk.mount}`} icon={<FiHardDrive aria-hidden="true" />} className="min-w-[170px] flex-1">
            <p className="mt-2 truncate text-sm font-medium text-text-primary">{formatBytes(disk.used)} <span className="text-text-tertiary">/ {formatBytes(disk.total)}</span></p>
            <UsageBar value={usage} />
          </StatCard>
        );
      })}
    </div>
  );
}

export function ActivityPane() {
  const [state, setState] = useState<LoadState>("loading");
  const [stats, setStats] = useState<SysmonStats | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [, setClock] = useState(0);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let disposeSocket: (() => void) | undefined;
    const connect = () => {
      if (disposed) return;
      setState((current) => current === "populated" ? current : "loading");
      disposeSocket = connectSysmon({
        onStats: (next) => {
          setStats(next);
          setState("populated");
          setLastUpdated(Date.now());
          setHistory((current) => [...current, next.cpuPercent].slice(-MAX_HISTORY));
        },
        onDisconnect: () => {
          if (disposed) return;
          setState((current) => current === "loading" ? "loading" : "disconnected");
          retry = setTimeout(connect, 1000);
        },
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      disposeSocket?.();
    };
  }, []);

  useEffect(() => {
    if (state !== "disconnected") return;
    const timer = setInterval(() => setClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  if (!stats) {
    return (
      <div className="grid h-full grid-rows-[auto_1fr] gap-3 p-3" aria-busy="true" aria-label="Loading Activity Monitor">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><Skeleton /><Skeleton /><Skeleton /></div>
        <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-8 animate-pulse rounded bg-bg-hover/40" />)}</div>
      </div>
    );
  }

  const memoryUsage = percent(stats.memUsed, stats.memTotal);
  const disconnected = state === "disconnected";
  return (
    <div className={`flex h-full min-h-0 flex-col gap-3 p-3 ${disconnected ? "opacity-60" : ""}`}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="CPU" icon={<FiCpu aria-hidden="true" />}>
          <p className={`mt-2 text-lg font-semibold leading-none ${thresholdTextColor(Math.min(100, stats.cpuPercent))}`}>{Math.round(stats.cpuPercent)}%</p>
          <div className={thresholdTextColor(Math.min(100, stats.cpuPercent))}><Sparkline values={history} /></div>
        </StatCard>
        <StatCard label="Memory" icon={<FiDatabase aria-hidden="true" />}>
          <p className="mt-2 text-sm font-medium text-text-primary">{formatBytes(stats.memUsed)} <span className="text-text-tertiary">/ {formatBytes(stats.memTotal)}</span></p>
          <UsageBar value={memoryUsage} />
        </StatCard>
        <DiskCards disks={stats.disks} />
      </div>
      {disconnected && lastUpdated && <p className="-mb-1 text-[11px] text-text-tertiary">Last updated {elapsedSince(lastUpdated)} ago</p>}
      <ProcessTable processes={stats.processes} />
    </div>
  );
}
