import { useEffect, useRef } from "react";
import { useWindowStore } from "../windows/store";
import { loadLayout, saveLayout, serializeLayout, deserializeLayout } from "./layout";

const SAVE_DEBOUNCE_MS = 1000;

export function useLayoutPersistence(daemonConnected: boolean) {
  const ready = useRef(false);
  const timer = useRef<number | null>(null);
  const loaded = useRef(false);

  // Load once the daemon is reachable, then hydrate the store.
  useEffect(() => {
    if (!daemonConnected || loaded.current) return;
    loaded.current = true;
    void (async () => {
      const layout = await loadLayout();
      if (layout) {
        const { innerWidth: w, innerHeight: h } = window;
        useWindowStore.getState().hydrate(deserializeLayout(layout, { w, h }));
      }
      ready.current = true;
    })();
  }, [daemonConnected]);

  // Debounced save on any window/space change, never per drag frame.
  useEffect(() => {
    const unsub = useWindowStore.subscribe(() => {
      if (!ready.current) return;
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const s = useWindowStore.getState();
        void saveLayout(serializeLayout(s.windows, s.spaces));
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);
}
