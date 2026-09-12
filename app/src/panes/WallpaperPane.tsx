import { useEffect, useState } from "react";
import { FiCheck, FiLoader, FiPlus, FiTrash2 } from "react-icons/fi";
import {
  BUILTIN_WALLPAPERS,
  useWallpaperStore,
} from "./wallpaperStore";
import { wallpaperAssetUrl, type CustomWallpaper } from "../lib/api";
import { useModalStore } from "../system/modalStore";
import { pickImages } from "../system/pickImage";
import { toast } from "../system/toast";

type UploadState = { kind: "idle" } | { kind: "uploading"; done: number; total: number };

export function WallpaperPane() {
  const current = useWallpaperStore((s) => s.current);
  const custom = useWallpaperStore((s) => s.custom);
  const status = useWallpaperStore((s) => s.status);
  const load = useWallpaperStore((s) => s.load);
  const select = useWallpaperStore((s) => s.select);
  const upload = useWallpaperStore((s) => s.upload);
  const remove = useWallpaperStore((s) => s.remove);

  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  const onPickTileClick = async () => {
    if (uploadState.kind !== "idle") return;
    const picked = await pickImages();
    if (picked.length === 0) return;
    setUploadState({ kind: "uploading", done: 0, total: picked.length });
    const failed: string[] = [];
    for (const [index, item] of picked.entries()) {
      try {
        await upload(item.blob, item.label);
      } catch (cause) {
        failed.push(cause instanceof Error ? cause.message : `“${item.label}”`);
      }
      setUploadState({ kind: "uploading", done: index + 1, total: picked.length });
    }
    setUploadState({ kind: "idle" });
    if (failed.length > 0) {
      toast.error(failed.length === 1 ? failed[0] : `${failed.length} uploads failed.`);
    }
    const created = picked.length - failed.length;
    if (created > 0) {
      toast.success(created === 1 ? `Created “${picked[0]?.label}”.` : `Created ${created} wallpapers.`);
    }
  };

  const onSelect = async (id: string, label: string) => {
    const applied = await select(id);
    if (!applied) toast.error(`Couldn't apply “${label}”.`);
  };

  const onDelete = (wallpaper: CustomWallpaper) => {
    requestConfirm({
      title: `Delete “${wallpaper.label}”?`,
      body: "This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        setDeletingId(wallpaper.id);
        remove(wallpaper.id)
          .then(() => toast.success(`Deleted “${wallpaper.label}”.`))
          .catch(() => toast.error(`Couldn't delete “${wallpaper.label}”.`))
          .finally(() => setDeletingId(null));
      },
    });
  };

  return (
    <section aria-label="Wallpaper">
      <h2 className="text-sm font-semibold text-text-primary">Wallpaper</h2>
      <ul role="list" className="mt-4 grid max-w-md grid-cols-4 gap-3">
        {BUILTIN_WALLPAPERS.map((builtin) => (
          <li key={builtin.id}>
            <Tile
              label={builtin.label}
              selected={current === builtin.id}
              showSelection={current != null}
              background={{ background: builtin.background }}
              onClick={() => void onSelect(builtin.id, builtin.label)}
            />
          </li>
        ))}
        {custom.map((wallpaper) => (
          <li key={wallpaper.id}>
            <Tile
              label={wallpaper.label}
              selected={current === wallpaper.id}
              showSelection={current != null}
              background={{
                backgroundImage: `url("${wallpaperAssetUrl(wallpaper.id, "thumb")}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              onClick={() => void onSelect(wallpaper.id, wallpaper.label)}
              deleteBadge
              onDelete={() => onDelete(wallpaper)}
              deleting={deletingId === wallpaper.id}
            />
          </li>
        ))}
        <li>
          <button
            onClick={() => void onPickTileClick()}
            disabled={status === "error"}
            aria-label="Add custom wallpapers"
            className={`group relative flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-bg-hover bg-transparent text-text-tertiary transition-colors hover:border-accent/50 hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent`}
          >
            {uploadState.kind === "uploading" ? (
              <span className="flex flex-col items-center gap-1" role="status" aria-label={`Uploading ${uploadState.done} of ${uploadState.total}`}>
                <FiLoader className="h-5 w-5 animate-spin" aria-hidden="true" />
                <span className="text-[10px] tabular-nums text-text-tertiary">
                  {uploadState.done}/{uploadState.total}
                </span>
              </span>
            ) : (
              <FiPlus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </li>
      </ul>
    </section>
  );
}

function Tile({
  label,
  selected,
  showSelection,
  background,
  onClick,
  deleteBadge,
  onDelete,
  deleting = false,
}: {
  label: string;
  selected: boolean;
  showSelection: boolean;
  background: React.CSSProperties;
  onClick: () => void;
  deleteBadge?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="group" aria-busy={deleting || undefined}>
      <div className="relative">
        <button
          onClick={onClick}
          disabled={deleting}
          aria-label={`${label}${selected ? ", current wallpaper" : ""}`}
          aria-pressed={selected}
          title={label}
          style={background}
          className={`block aspect-square w-full rounded-lg transition-shadow focus-visible:outline-2 focus-visible:outline-accent ${
            selected && showSelection ? "ring-2 ring-accent ring-offset-2 ring-offset-bg-surface" : ""
          }`}
        >
          {/* visual tile — the gradient/image lives on the button's own background */}
        </button>
        {selected && showSelection && (
          <span
            className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-bg-base"
            aria-hidden="true"
          >
            <FiCheck className="h-3 w-3" />
          </span>
        )}
        {deleting && (
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/40"
            role="status"
            aria-label={`Deleting ${label}`}
          >
            <FiLoader className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
          </span>
        )}
        {deleteBadge && onDelete && !deleting && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label={`Delete ${label}`}
            className="absolute left-1 top-1 hidden rounded p-1 text-text-secondary hover:bg-status-danger hover:text-white group-hover:flex focus-visible:flex focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Persistent name under each tile — hover-only tooltips don't differentiate a grid. */}
      <p
        className={`mt-1 truncate text-center text-[10px] leading-tight ${
          selected ? "font-medium text-accent" : "text-text-tertiary"
        }`}
      >
        {label}
      </p>
    </div>
  );
}
