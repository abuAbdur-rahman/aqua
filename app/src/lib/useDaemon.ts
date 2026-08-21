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
    let interval: number;

    (async () => {
      await pollHealth();
      if (cancelled) return;

      const ws = new WebSocket(wsUrl("/ws/echo"));
      ws.onopen = () => {
        ws.send("ping");
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
        if (!cancelled) pollHealth();
      }, 30_000);

      return () => {
        cancelled = true;
        ws.close();
        clearInterval(interval);
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [pollHealth]);

  return { state, version, wsConnected };
}