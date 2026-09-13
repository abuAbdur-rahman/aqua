import { useEffect, useRef } from "react";
import { useWindowStore } from "../windows/store";
import { loadLayout, saveLayout, serializeLayout, deserializeLayout } from "./layout";
import { toast } from "../system/toast";

const SAVE_DEBOUNCE_MS = 1000;
// The daemon validates the layout strictly and answers 400 when it rejects
// the shape. Retrying an identical shape on every window change only spams
// the console — pause saves for the session after repeated rejections.
const MAX_SAVE_FAILURES = 3;

export function useLayoutPersistence(daemonConnected: boolean) {
  const ready = useRef(false);
  const timer = useRef<number | null>(null);
  const loaded = useRef(false);
  const saveFailures = useRef(0);

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
  // Pauses for the session after repeated daemon rejections (see above).
  useEffect(() => {
    const unsub = useWindowStore.subscribe(() => {
      if (!ready.current || saveFailures.current >= MAX_SAVE_FAILURES) return;
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const s = useWindowStore.getState();
        void saveLayout(serializeLayout(s.windows, s.spaces)).then((ok) => {
          if (ok) {
            saveFailures.current = 0;
            return;
          }
          saveFailures.current += 1;
          if (saveFailures.current === MAX_SAVE_FAILURES) {
            toast.error("Daemon rejected the window layout — persistence paused for this session.");
          }
        });
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);
}
