import { useEffect, useState, useCallback } from "react";
import { checkHealth, wsUrl } from "./api";

export type DaemonState = "connecting" | "connected" | "failed";

export function useDaemonConnection() {
  const [state, setState] = useState<DaemonState>("connecting");
  const [version, setVersion] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const pollHealth = useCallback(async () => {
    try {
      const res = await checkHealth();
      setVersion(res.version);
      setState("connected");
    } catch {
      setState("failed");
      setVersion(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let interval: number | undefined;

    const connect = async () => {
      try {
        const res = await checkHealth();
        if (cancelled) return;
        setVersion(res.version);
        setState("connected");

        ws = new WebSocket(wsUrl("/ws/echo"));
        ws.onopen = () => {
          ws?.send("ping");
          if (!cancelled) setWsConnected(true);
        };
        ws.onmessage = () => {};
        ws.onclose = () => {
          if (!cancelled) setWsConnected(false);
        };
        ws.onerror = () => {
          if (!cancelled) setWsConnected(false);
        };

        interval = window.setInterval(() => {
          if (!cancelled) void pollHealth();
        }, 30_000);
      } catch {
        if (!cancelled) {
          setState("failed");
          setVersion(null);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [pollHealth]);

  return { state, version, wsConnected };
}