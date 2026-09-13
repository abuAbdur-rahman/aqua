import { useEffect, useMemo, useState } from "react";
import { appManifest } from "../windows/manifest";
import { useWindowStore } from "../windows/store";

interface Props {
  open: boolean;
  onClose: (selectedAppId: string | null) => void;
}

export function ControlTabOverlay({ open, onClose }: Props) {
  const windows = useWindowStore((s) => s.windows);
  const focus = useWindowStore((s) => s.focus);

  const apps = useMemo(() => {
    const byApp = new Map<string, { appId: string; z: number }>();
    for (const w of windows) {
      const prev = byApp.get(w.appId);
      if (!prev || w.z > prev.z) byApp.set(w.appId, { appId: w.appId, z: w.z });
    }
    return [...byApp.values()].sort((a, b) => b.z - a.z).map((e) => e.appId);
  }, [windows]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open ]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Tab" && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        setIndex((i) => (apps.length ? (i + 1) % apps.length : 0));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose(null);
      } else if (!e.ctrlKey || !e.shiftKey) {
        const selected = apps[index] ?? null;
        if (selected) {
          const state = useWindowStore.getState();
          const top = state.windows
            .filter((w) => w.appId === selected)
            .reduce<(typeof state.windows)[number] | null>((a, b) => (a && a.z > b.z ? a : b), null);
          if (top) focus(top.id);
        }
        onClose(selected);
      }
    };
    window.addEventListener("keyup", onKey);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, apps, index, focus, onClose]);

  if (!open || apps.length === 0) return null;
  const selected = apps[index] ?? apps[0];

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40" aria-label="App switcher">
      <div className="flex items-start gap-4 rounded-xl bg-bg-overlay px-5 pb-3 pt-4 shadow-xl">
        {apps.map((appId) => {
          const manifest = appManifest[appId];
          const active = appId === selected;
          return (
            <div key={appId} className="flex w-20 flex-col items-center gap-1">
              <img
                src={manifest?.icon ?? "/icons/icon-finder.svg"}
                alt=""
                aria-hidden="true"
                style={{ width: active ? 72 : 64, height: active ? 72 : 64 }}
                className={`rounded-2xl transition-all duration-[120ms] ease-out ${active ? "outline-2 outline-accent-ring" : ""}`}
              />
              {active && <span className="text-[13px] text-text-primary">{manifest?.name ?? appId}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
