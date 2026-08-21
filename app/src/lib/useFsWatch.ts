import { useEffect, useRef } from "react";
import { parseFsWatchEvent, type FsWatchEvent } from "./filesystem";
import { wsUrl } from "./api";

export function useFsWatch(path: string, onEvent: (event: FsWatchEvent) => void) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let stopped = false;
    let reconnectDelay = 250;

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(wsUrl("/ws/fs-watch"));
      socket.onopen = () => {
        reconnectDelay = 250;
        socket?.send(JSON.stringify({ type: "subscribe", path }));
      };
      socket.onmessage = (message) => {
        try {
          const event = parseFsWatchEvent(JSON.parse(String(message.data)));
          if (event) handlerRef.current(event);
        } catch {
          // Ignore malformed frames; the next valid fs event remains usable.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "unsubscribe", path }));
      }
      socket?.close();
    };
  }, [path]);
}
