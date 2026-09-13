const ROWS: Array<{ action: string; chord: string }> = [
  { action: "Control-Tab (app switcher)", chord: "Ctrl+Shift+Tab" },
  { action: "Command Center", chord: "Ctrl+Shift+/" },
  { action: "Spotlight", chord: "Ctrl+Shift+Space" },
  { action: "Zoom in / out", chord: "Ctrl+Plus / Ctrl+Minus" },
];

export function HotkeysPane() {
  return (
    <section aria-label="Hotkeys" className="max-w-md">
      <h2 className="text-sm font-semibold text-text-primary">Hotkeys</h2>
      <p className="mt-2 text-xs text-text-secondary">Read-only reference. Rebinding is deferred.</p>
      <table className="mt-4 w-full text-xs">
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.action} className="h-8 border-b border-bg-hover last:border-0">
              <td className="text-text-primary">{row.action}</td>
              <td className="text-right font-mono text-text-secondary">{row.chord}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-text-tertiary">Zoom is per-app: Finder density, Terminal/Editor/Reader font, Gallery scale.</p>
    </section>
  );
}
