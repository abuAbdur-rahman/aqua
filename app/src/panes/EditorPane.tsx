type State = "loading" | "empty" | "populated" | "error-read" | "error-write" | "truncated" | "binary";
export function EditorPane({ state = "populated" as State }) {
  if (state === "loading") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-7 items-center gap-2 border-b border-bg-hover bg-bg-elevated px-2">
          <div className="h-5 w-20 rounded bg-bg-hover animate-pulse" />
          <div className="h-5 w-16 rounded bg-bg-hover/60" />
        </div>
        <div className="flex-1 p-3 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-3 w-3/4 rounded bg-bg-hover/40 animate-pulse" />)}</div>
      </div>
    );
  }
  if (state === "truncated") {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-status-warning bg-status-warning/10 px-3 py-1.5 text-[11px] text-text-secondary">This file is large — showing the first portion. Editing and saving are disabled.</div>
        <div className="flex-1 bg-bg-surface p-3 font-mono text-xs text-text-tertiary">/* truncated content */</div>
      </div>
    );
  }
  if (state === "binary") {
    return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"><p className="text-sm text-text-primary">This file can&apos;t be edited here</p><button className="text-xs text-accent">Open in Finder</button></div>;
  }
  if (state === "error-read") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-7 items-center gap-2 border-b border-bg-hover bg-bg-elevated px-2 text-xs"><span className="rounded bg-bg-surface px-2 py-0.5">README.md</span></div>
        <div className="m-3 rounded-card border-l-2 border-status-danger bg-status-danger/10 p-3">
          <p className="text-xs font-medium text-text-primary">This file no longer exists</p>
          <div className="mt-2 flex gap-2"><button className="text-xs text-text-tertiary">Close tab</button><button className="text-xs text-accent">Save as new file</button></div>
        </div>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-7 items-center gap-2 border-b border-bg-hover bg-bg-elevated px-2 text-xs"><span className="rounded bg-bg-surface px-2 py-0.5">untitled</span></div>
        <div className="flex-1 bg-bg-surface p-3 font-mono text-xs text-text-primary"><span className="inline-block h-4 w-px bg-accent" /> </div>
        <div className="flex h-6 items-center justify-between border-t border-bg-hover bg-bg-elevated px-3 text-[11px] text-text-tertiary"><span>untitled — UTF-8 — Plain Text — Ln 1, Col 1</span><span>Saved</span></div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 items-center gap-1 border-b border-bg-hover bg-bg-elevated px-1 text-xs">
        <span className="rounded bg-bg-surface px-2 py-0.5 text-text-primary">README.md</span>
        <span className="flex items-center gap-1 rounded px-2 py-0.5 text-text-secondary"><span className="h-1.5 w-1.5 rounded-full bg-accent" />main.rs</span>
        <span className="ml-1 text-text-tertiary">+</span>
      </div>
      <div className="flex flex-1 bg-bg-surface font-mono text-xs">
        <div className="select-none border-r border-bg-hover bg-bg-surface px-2 py-2 text-right text-text-tertiary">1<br />2<br />3</div>
        <div className="flex-1 p-2 text-text-primary"><span className="text-text-tertiary">#</span> Aqua<br /><br />A real, daily-driver desktop for WSL…</div>
      </div>
      <div className="flex h-6 items-center justify-between border-t border-bg-hover bg-bg-elevated px-3 text-[11px]">
        <span className="text-text-tertiary">README.md — UTF-8 — Markdown — Ln 3, Col 1</span>
        <span className={state === "error-write" ? "text-status-danger" : "text-text-tertiary"}>{state === "error-write" ? "Couldn't save" : "Saved"}</span>
      </div>
    </div>
  );
}
