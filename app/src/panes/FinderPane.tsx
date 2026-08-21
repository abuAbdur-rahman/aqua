import { FiFolder, FiFile, FiImage, FiFileText } from "react-icons/fi";

type State = "loading" | "empty" | "populated" | "error";
export function FinderPane({ state = "populated" as State }) {
  if (state === "loading") {
    return (
      <div className="flex h-full">
        <div className="w-44 shrink-0 border-r border-bg-hover bg-bg-elevated p-3">
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-6 rounded bg-bg-hover/60 animate-pulse" />)}</div>
        </div>
        <div className="flex-1 p-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-7 rounded bg-bg-hover/50 animate-pulse" />)}
        </div>
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className="flex h-full">
        <div className="w-44 shrink-0 border-r border-bg-hover bg-bg-elevated p-3">
          <div className="rounded bg-accent-bg px-2 py-1.5 text-xs font-medium text-accent">⌂ Home</div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FiFolder className="h-10 w-10 text-text-tertiary" aria-hidden="true" />
          <p className="text-sm font-medium text-text-primary">This folder is empty</p>
          <button className="rounded-card bg-accent px-3 py-1.5 text-xs font-medium text-bg-base hover:bg-accent-strong">New Folder</button>
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex h-full flex-col">
        <div className="border-l-2 border-status-danger bg-status-danger/10 px-3 py-2 text-xs">
          <p className="font-medium text-text-primary">Couldn&apos;t complete that action</p>
          <p className="font-mono text-[11px] text-text-secondary">ENOENT: path not found</p>
        </div>
        <div className="p-4 text-xs text-text-tertiary">Go to parent folder or retry.</div>
      </div>
    );
  }
  return (
    <div className="flex h-full text-xs">
      <div className="w-44 shrink-0 border-r border-bg-hover bg-bg-elevated p-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded bg-accent-bg px-2 py-1.5 text-accent"><span>⌂</span> Home</div>
          <div className="flex items-center gap-2 px-2 py-1 text-text-secondary"><FiFolder className="h-3.5 w-3.5" /> projects</div>
          <div className="flex items-center gap-2 px-2 py-1 text-text-secondary"><FiFolder className="h-3.5 w-3.5" /> Downloads</div>
          <div className="my-2 border-t border-bg-hover" />
          <div className="flex items-center gap-2 px-2 py-1 text-text-tertiary"><FiTrash2Icon /> Trash</div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-bg-hover px-3 py-2 text-[11px] text-text-tertiary">
          <span className="hover:text-text-primary">~</span> / <span className="hover:text-text-primary">projects</span> / <span className="text-text-primary">aqua</span>
        </div>
        <div className="flex flex-1">
          <div className="flex-1">
            <div className="grid grid-cols-[1fr_80px_90px] gap-2 border-b border-bg-hover px-3 py-1.5 text-[11px] font-medium text-text-tertiary">
              <span>Name</span><span>Size</span><span>Modified</span>
            </div>
            <div className="divide-y divide-bg-hover/50">
              <div className="grid grid-cols-[1fr_80px_90px] items-center px-3 py-1.5 hover:bg-bg-hover/40"><span className="flex items-center gap-1.5"><FiFolder className="h-3.5 w-3.5 text-accent" />daemon</span><span className="text-text-tertiary">—</span><span className="text-text-tertiary">2h ago</span></div>
              <div className="grid grid-cols-[1fr_80px_90px] items-center bg-accent-bg px-3 py-1.5"><span className="flex items-center gap-1.5"><FiFileText className="h-3.5 w-3.5" />README.md</span><span>4 KB</span><span>1d ago</span></div>
              <div className="grid grid-cols-[1fr_80px_90px] items-center px-3 py-1.5 hover:bg-bg-hover/40"><span className="flex items-center gap-1.5"><FiImage className="h-3.5 w-3.5" />wallpaper.png</span><span>2.1 MB</span><span>3d ago</span></div>
              <div className="grid grid-cols-[1fr_80px_90px] items-center px-3 py-1.5 hover:bg-bg-hover/40"><span className="flex items-center gap-1.5"><FiFile className="h-3.5 w-3.5" />CONTRACT.md</span><span>6 KB</span><span>1d ago</span></div>
            </div>
          </div>
          <div className="hidden w-48 shrink-0 border-l border-bg-hover bg-bg-overlay/30 p-3 lg:block">
            <p className="text-[11px] font-medium text-text-primary">README.md — 4 KB</p>
            <div className="mt-2 rounded border border-bg-hover bg-bg-surface p-2 text-[11px] leading-relaxed text-text-secondary">Preview pane — image / pdf / markdown render per spec.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
function FiTrash2Icon() {
  return <span className="text-[12px]" aria-hidden="true">🗑</span>;
}
