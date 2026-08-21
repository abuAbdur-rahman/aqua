import { motion } from "framer-motion";
import { FiFile, FiCpu, FiSearch } from "react-icons/fi";

export function SpotlightPane({ open = true, onClose }: { open: boolean; onClose?: () => void }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-black/20 pt-[12%] backdrop-blur-[1px]" onMouseDown={onClose}>
      <motion.div
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }}
        style={{ willChange: "transform, opacity" }}
        className="w-[560px] max-w-[92%] overflow-hidden rounded-window border border-bg-hover bg-bg-overlay shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center gap-2 border-b border-bg-hover px-3 py-2">
          <FiSearch className="h-4 w-4 text-text-tertiary" aria-hidden="true" />
          <input autoFocus placeholder="Search files, apps, or type a calculation" className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none" />
        </div>
        <div className="p-2">
          <p className="px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary">FILES</p>
          <div className="rounded bg-accent-bg px-2 py-1.5 text-xs text-text-primary flex items-center gap-2"><FiFile className="h-3.5 w-3.5" /> fs/mod.rs <span className="text-text-tertiary">daemon/src/fs</span></div>
          <div className="px-2 py-1.5 text-xs text-text-secondary flex items-center gap-2"><FiFile className="h-3.5 w-3.5" /> CONTRACT.md <span className="text-text-tertiary">· GET /api/fs/…</span></div>
          <p className="mt-2 px-2 py-1 text-[10px] font-semibold tracking-widest text-text-tertiary">QUICK ACTIONS</p>
          <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-secondary"><FiCpu className="h-3.5 w-3.5" /> 42 * 12 → 504</div>
        </div>
      </motion.div>
    </div>
  );
}
