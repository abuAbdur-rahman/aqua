import { describe, expect, it, vi } from "vitest";
import { createResizeScheduler, openPtySession } from "./pty";

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly sent: Array<string | Uint8Array> = [];
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  readyState = FakeWebSocket.OPEN;
  binaryType = "arraybuffer";

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }

  send(data: string | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  emit(type: string, data?: string | ArrayBuffer) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

describe("openPtySession", () => {
  it("spawns with dimensions, bridges input, and handles exit control", async () => {
    const socket = new FakeWebSocket();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionId: "session/one" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const output = vi.fn();
    const exit = vi.fn();

    const sessionPromise = openPtySession({
      cols: 90,
      rows: 30,
      cwd: ".",
      onOutput: output,
      onExit: exit,
      onDisconnect: vi.fn(),
      websocketFactory: () => {
        queueMicrotask(() => socket.emit("open"));
        return socket as unknown as WebSocket;
      },
    });
    const session = await sessionPromise;

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:61234/api/pty/spawn", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ cols: 90, rows: 30, cwd: "." }),
    }));
    expect(session.sessionId).toBe("session/one");

    session.sendInput(new Uint8Array([65, 10]));
    session.resize(100, 40);
    expect(socket.sent[0]).toEqual(new Uint8Array([65, 10]));
    expect(socket.sent[1]).toBe(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));

    socket.emit("message", new Uint8Array([79, 75]).buffer);
    socket.emit("message", JSON.stringify({ type: "exit", code: 0 }));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(output).toHaveBeenCalledWith(new Uint8Array([79, 75]));
    expect(exit).toHaveBeenCalledWith({ type: "exit", code: 0 });

    session.dispose();
    expect(socket.readyState).toBe(3);
  });
});

describe("createResizeScheduler", () => {
  it("sends only the final dimensions", () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const scheduler = createResizeScheduler(send, 120);

    scheduler.schedule(80, 24);
    scheduler.schedule(100, 30);
    vi.advanceTimersByTime(119);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(100, 30);

    scheduler.dispose();
    vi.useRealTimers();
  });
});
