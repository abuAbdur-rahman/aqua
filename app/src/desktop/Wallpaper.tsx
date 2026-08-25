import { useEffect } from "react";
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { wallpaperAssetUrl } from "../lib/api";
import { systemReducedMotion } from "../lib/prefs";
import { BUILTIN_WALLPAPERS, DEFAULT_WALLPAPER_ID, useWallpaperStore } from "../panes/wallpaperStore";

function resolve(id: string | null): { key: string; style: CSSProperties } {
  if (id != null && !BUILTIN_WALLPAPERS.some((b) => b.id === id)) {
    return {
      key: id,
      style: {
        backgroundImage: `url("${wallpaperAssetUrl(id, "full")}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      },
    };
  }
  const builtin =
    BUILTIN_WALLPAPERS.find((b) => b.id === id) ??
    BUILTIN_WALLPAPERS.find((b) => b.id === DEFAULT_WALLPAPER_ID) ??
    BUILTIN_WALLPAPERS[0];
  if (!builtin) return { key: "empty", style: {} };
  return { key: builtin.id, style: { background: builtin.background } };
}

export function Wallpaper({ daemonConnected }: { daemonConnected: boolean }) {
  const status = useWallpaperStore((s) => s.status);
  const current = useWallpaperStore((s) => s.current);
  const load = useWallpaperStore((s) => s.load);

  useEffect(() => {
    if (daemonConnected && status === "idle") void load();
  }, [daemonConnected, status, load]);

  const { key, style } = resolve(current);
  const reduced = systemReducedMotion();

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={key}
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.1 : 0.22, ease: [0.4, 0, 0.2, 1] }}
        style={{ ...style, willChange: "opacity" }}
        aria-hidden="true"
      />
    </AnimatePresence>
  );
}
