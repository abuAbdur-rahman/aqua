import { useEffect, useRef, useState } from "react";
import { FiCheck, FiLoader, FiPlus, FiTrash2, FiX } from "react-icons/fi";
import {
  BUILTIN_WALLPAPERS,
  useWallpaperStore,
} from "./wallpaperStore";
import { wallpaperAssetUrl, type CustomWallpaper } from "../lib/api";
import { useModalStore } from "../system/modalStore";
import { pickImage } from "../system/pickImage";

type UploadState = "idle" | "picking" | "uploading" | "error";

export function WallpaperPane() {
  const current = useWallpaperStore((s) => s.current);
  const custom = useWallpaperStore((s) => s.custom);
  const status = useWallpaperStore((s) => s.status);
  const load = useWallpaperStore((s) => s.load);
  const select = useWallpaperStore((s) => s.select);
  const upload = useWallpaperStore((s) => s.upload);
  const remove = useWallpaperStore((s) => s.remove);

  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const errorTimer = useRef<number | null>(null);

  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);

  useEffect(() => {
    return () => {
      if (errorTimer.current != null) window.clearTimeout(errorTimer.current);
    };
  }, []);

  const flashError = (message: string) => {
    setNotice(message);
    if (errorTimer.current != null) window.clearTimeout(errorTimer.current);
    // Low-stakes failure: show briefly next to the "+" tile, then move on.
    errorTimer.current = window.setTimeout(() => setNotice(null), 2000);
  };

  const onPickTileClick = async () => {
    if (uploadState !== "idle") return;
    setUploadState("picking");
    try {
      const picked = await pickImage();
      if (!picked) {
        setUploadState("idle");
        return;
      }
      setUploadState("uploading");
      await upload(picked.blob, picked.label);
      setUploadState("idle");
    } catch (cause) {
      setUploadState("error");
      flashError(cause instanceof Error ? cause.message : "Upload failed.");
      window.setTimeout(() => setUploadState("idle"), 2000);
    }
  };

  const onSelect = async (id: string, label: string) => {
    const applied = await select(id);
    if (!applied) flashError(`Couldn't apply “${label}”.`);
  };

  const onDelete = (wallpaper: CustomWallpaper) => {
    requestConfirm({
      title: `Delete “${wallpaper.label}”?`,
      body: "This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        remove(wallpaper.id).catch(() => flashError(`Couldn't delete “${wallpaper.label}”.`));
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
            />
          </li>
        ))}
        <li>
          <button
            onClick={() => void onPickTileClick()}
            disabled={status === "error"}
            aria-label="Add a custom wallpaper"
            className={`group relative flex aspect-square w-full items-center justify-center rounded-lg border border-dashed bg-transparent text-text-tertiary transition-colors hover:border-accent/50 hover:text-text-secondary focus-visible:outline-2 focus-visible:outline-accent ${
              uploadState === "error" ? "border-status-danger text-status-danger" : "border-bg-hover"
            }`}
          >
            {uploadState === "uploading" ? (
              <FiLoader className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : uploadState === "error" ? (
              <FiX className="h-5 w-5" aria-hidden="true" />
            ) : (
              <FiPlus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </li>
      </ul>
      <p className="mt-2 h-4 text-[11px] text-status-danger" role="status">
        {notice}
      </p>
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
}: {
  label: string;
  selected: boolean;
  showSelection: boolean;
  background: React.CSSProperties;
  onClick: () => void;
  deleteBadge?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
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
      {deleteBadge && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete ${label}`}
          className="absolute left-1 top-1 hidden rounded p-1 text-text-secondary group-hover:flex hover:bg-status-danger hover:text-white focus-visible:flex focus-visible:outline-2 focus-visible:outline-accent"
        >
          <FiTrash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
