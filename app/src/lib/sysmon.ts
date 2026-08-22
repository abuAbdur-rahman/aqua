import { wsUrl } from "./api";

export interface DiskStat {
  mount: string;
  used: number;
  total: number;
}

export interface ProcessStat {
  pid: number;
  name: string;
  cpuPercent: number;
  memBytes: number;
}

export interface SysmonStats {
  type: "stats";
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  disks: DiskStat[];
  processes: ProcessStat[];
}

type SysmonOptions = {
  onStats: (stats: SysmonStats) => void;
  onDisconnect: () => void;
  websocketFactory?: (url: string) => WebSocket;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseDisk(value: unknown): DiskStat | null {
  if (!isRecord(value) || typeof value.mount !== "string" || !isFiniteNumber(value.used) || !isFiniteNumber(value.total)) return null;
  return { mount: value.mount, used: value.used, total: value.total };
}

function parseProcess(value: unknown): ProcessStat | null {
  if (!isRecord(value) || !Number.isInteger(value.pid) || typeof value.name !== "string" || !isFiniteNumber(value.cpuPercent) || !isFiniteNumber(value.memBytes)) return null;
  const pid = value.pid as number;
  if (pid < 0) return null;
  return { pid, name: value.name, cpuPercent: value.cpuPercent, memBytes: value.memBytes };
}

export function parseSysmonStats(value: unknown): SysmonStats | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || parsed.type !== "stats" || !isFiniteNumber(parsed.cpuPercent) || !isFiniteNumber(parsed.memUsed) || !isFiniteNumber(parsed.memTotal) || !Array.isArray(parsed.disks) || !Array.isArray(parsed.processes)) return null;
  const disks = parsed.disks.map(parseDisk);
  const processes = parsed.processes.map(parseProcess);
  if (disks.some((disk) => disk === null) || processes.some((process) => process === null)) return null;
  return {
    type: "stats",
    cpuPercent: parsed.cpuPercent,
    memUsed: parsed.memUsed,
    memTotal: parsed.memTotal,
    disks: disks as DiskStat[],
    processes: processes as ProcessStat[],
  };
}

export function connectSysmon(options: SysmonOptions): () => void {
  const socket = (options.websocketFactory ?? ((url) => new WebSocket(url)))(wsUrl("/ws/sysmon"));
  let disposed = false;
  let disconnected = false;
  const disconnect = () => {
    if (!disposed && !disconnected) {
      disconnected = true;
      options.onDisconnect();
    }
  };
  const onMessage = (event: MessageEvent) => {
    const stats = parseSysmonStats(event.data);
    if (stats) options.onStats(stats);
  };
  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", disconnect);
  socket.addEventListener("close", disconnect);
  return () => {
    disposed = true;
    socket.removeEventListener("message", onMessage);
    socket.close();
  };
}
