import { DOCK_SIZE_MAX, DOCK_SIZE_MIN, usePrefsStore } from "../lib/prefs";

export function AppearancePane() {
  const reduceMotion = usePrefsStore((s) => s.reduceMotion);
  const setReduceMotion = usePrefsStore((s) => s.setReduceMotion);
  const dockSize = usePrefsStore((s) => s.dockSize);
  const setDockSize = usePrefsStore((s) => s.setDockSize);

  return (
    <section aria-label="Appearance" className="max-w-md">
      <h2 className="text-sm font-semibold text-text-primary">Appearance</h2>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Aqua is dark-mode only. A light theme isn&rsquo;t planned.
      </p>

      <div className="mt-5 flex items-center justify-between gap-4">
        <label htmlFor="reduce-motion" className="text-xs text-text-primary">
          Reduce motion
        </label>
        <button
          id="reduce-motion"
          role="switch"
          aria-checked={reduceMotion}
          onClick={() => setReduceMotion(!reduceMotion)}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent ${
            reduceMotion ? "bg-accent" : "bg-bg-hover"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-text-primary transition-transform duration-100 ${
              reduceMotion ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
            aria-hidden="true"
          />
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
        Replaces window, Dock, and Spotlight animation with a plain 100ms cross-fade.
      </p>

      <div className="mt-5 flex items-center justify-between gap-4">
        <label htmlFor="dock-size" className="text-xs text-text-primary">
          Dock icon size
        </label>
        <span className="flex items-center gap-2">
          <input
            id="dock-size"
            type="range"
            min={DOCK_SIZE_MIN}
            max={DOCK_SIZE_MAX}
            step={2}
            value={dockSize}
            onChange={(e) => setDockSize(Number(e.target.value))}
            className="w-40 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
          />
          <span className="w-8 text-right text-xs tabular-nums text-text-secondary">{dockSize}px</span>
        </span>
      </div>
    </section>
  );
}
