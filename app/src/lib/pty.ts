import { fetchJson, wsUrl } from "./api";

export interface PtyExit {
  type: "exit";
  code: number;
}

export interface PtyResize {
  type: "resize";
  cols: number;
  rows: number;
}

export interface PtySessionOptions {
  cols: number;
  rows: number;
  cwd?: string;
  onOutput: (data: Uint8Array) => void;
  onExit: (exit: PtyExit) => void;
  onDisconnect: () => void;
  websocketFactory?: (url: string) => WebSocket;
}

export interface PtySession {
  readonly sessionId: string;
  sendInput: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  dispose: () => void;
}

function parseControl(data: string): PtyExit | null {
  try {
    const value: unknown = JSON.parse(data);
    if (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "exit" &&
      "code" in value &&
      typeof value.code === "number"
    ) {
      return { type: "exit", code: value.code };
    }
  } catch {
    return null;
  }
  return null;
}

function toBytes(data: string | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (typeof data === "string") return Promise.resolve(new TextEncoder().encode(data));
  if (data instanceof Blob) return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return Promise.resolve(new Uint8Array(data));
}

export async function openPtySession(options: PtySessionOptions): Promise<PtySession> {
  const response = await fetchJson<{ sessionId: string }>("/api/pty/spawn", {
    method: "POST",
    body: JSON.stringify({ cols: options.cols, rows: options.rows, ...(options.cwd ? { cwd: options.cwd } : {}) }),
  });
  const socket = (options.websocketFactory ?? ((url) => new WebSocket(url)))(wsUrl(`/ws/pty/${encodeURIComponent(response.sessionId)}`));
  socket.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      reject(new Error("PTY WebSocket connection failed"));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });

  let disposed = false;
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      const exit = parseControl(event.data);
      if (exit) {
        options.onExit(exit);
        return;
      }
    }
    void toBytes(event.data as string | ArrayBuffer | Blob).then((bytes) => {
      options.onOutput(bytes);
    });
  });
  socket.addEventListener("close", () => {
    if (!disposed) options.onDisconnect();
  });

  return {
    sessionId: response.sessionId,
    sendInput: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    resize: (cols, rows) => {
      if (socket.readyState === WebSocket.OPEN) {
        const frame: PtyResize = { type: "resize", cols, rows };
        socket.send(JSON.stringify(frame));
      }
    },
    dispose: () => {
      disposed = true;
      socket.close();
    },
  };
}

export function createResizeScheduler(send: (cols: number, rows: number) => void, delay = 120) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: PtyResize | undefined;
  return {
    schedule: (cols: number, rows: number) => {
      pending = { type: "resize", cols, rows };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) send(pending.cols, pending.rows);
        pending = undefined;
      }, delay);
    },
    dispose: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
