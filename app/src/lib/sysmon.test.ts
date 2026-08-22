import { afterEach, describe, expect, it, vi } from "vitest";
import { connectSysmon, parseSysmonStats, type SysmonStats } from "./sysmon";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  readyState = FakeWebSocket.OPEN;

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

const stats: SysmonStats = {
  type: "stats",
  cpuPercent: 42.5,
  memUsed: 6_100,
  memTotal: 16_000,
  disks: [{ mount: "/", used: 212, total: 512 }],
  processes: [{ pid: 1, name: "init", cpuPercent: 2.5, memBytes: 1024 }],
};

afterEach(() => vi.restoreAllMocks());

describe("parseSysmonStats", () => {
  it("accepts the daemon contract shape", () => {
    expect(parseSysmonStats(JSON.stringify(stats))).toEqual(stats);
  });

  it("rejects malformed frames and non-finite values", () => {
    expect(parseSysmonStats(JSON.stringify({ ...stats, cpuPercent: Infinity }))).toBeNull();
    expect(parseSysmonStats(JSON.stringify({ ...stats, processes: [{ pid: "1" }] }))).toBeNull();
    expect(parseSysmonStats("not json")).toBeNull();
  });
});

describe("connectSysmon", () => {
  it("delivers stats and suppresses disconnect after disposal", () => {
    const socket = new FakeWebSocket();
    const onStats = vi.fn();
    const onDisconnect = vi.fn();
    const dispose = connectSysmon({
      websocketFactory: () => socket as unknown as WebSocket,
      onStats,
      onDisconnect,
    });

    socket.emit("message", JSON.stringify(stats));
    expect(onStats).toHaveBeenCalledWith(stats);

    dispose();
    socket.emit("close");
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("reports socket errors as disconnects", () => {
    const socket = new FakeWebSocket();
    const onDisconnect = vi.fn();
    connectSysmon({
      websocketFactory: () => socket as unknown as WebSocket,
      onStats: vi.fn(),
      onDisconnect,
    });

    socket.emit("error");
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
