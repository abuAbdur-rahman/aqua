import {
  ACCENT_PRESETS,
  DOCK_SIZE_MAX,
  DOCK_SIZE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  usePrefsStore,
} from "../lib/prefs";

export function AppearancePane() {
  const reduceMotion = usePrefsStore((s) => s.reduceMotion);
  const setReduceMotion = usePrefsStore((s) => s.setReduceMotion);
  const dockSize = usePrefsStore((s) => s.dockSize);
  const setDockSize = usePrefsStore((s) => s.setDockSize);
  const uiScale = usePrefsStore((s) => s.uiScale);
  const setUiScale = usePrefsStore((s) => s.setUiScale);
  const accent = usePrefsStore((s) => s.accent);
  const setAccent = usePrefsStore((s) => s.setAccent);

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

      <div className="mt-5 flex items-center justify-between gap-4">
        <label htmlFor="ui-scale" className="text-xs text-text-primary">
          App font size
        </label>
        <span className="flex items-center gap-2">
          <input
            id="ui-scale"
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={5}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="w-40 accent-accent focus-visible:outline-2 focus-visible:outline-accent"
          />
          <span className="w-10 text-right text-xs tabular-nums text-text-secondary">{uiScale}%</span>
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
        Scales the whole interface, not just text.
      </p>

      <fieldset className="mt-5">
        <legend className="text-xs text-text-primary">Accent color</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Accent color">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              role="radio"
              aria-checked={accent.id === preset.id}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => setAccent({ id: preset.id, hex: preset.hex })}
              className={`h-7 w-7 rounded-full transition-shadow focus-visible:outline-2 focus-visible:outline-accent ${
                accent.id === preset.id ? "ring-2 ring-text-primary ring-offset-2 ring-offset-bg-surface" : "hover:scale-110"
              }`}
              style={{ backgroundColor: preset.hex }}
            />
          ))}
          <label
            className={`relative flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-bg-hover text-[9px] text-text-tertiary hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-accent ${
              accent.id === "custom" ? "ring-2 ring-text-primary ring-offset-2 ring-offset-bg-surface" : ""
            }`}
            title="Custom color"
          >
            {accent.id === "custom" ? (
              <span className="absolute inset-0" style={{ backgroundColor: accent.hex }} />
            ) : (
              "+"
            )}
            <input
              type="color"
              aria-label="Custom accent color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={accent.hex}
              onChange={(e) => setAccent({ id: "custom", hex: e.target.value })}
            />
          </label>
        </div>
      </fieldset>
    </section>
  );
}
