import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { emptyTrash, listTrash, type TrashEntry } from "../../lib/filesystem";
import { useModalStore } from "../../system/modalStore";
import { toast } from "../../system/toast";
import { useFsWatch } from "../../lib/useFsWatch";

export function TrashPreviewWidget() {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const requestConfirm = useModalStore((s) => s.requestConfirm);
  const load = useCallback(async () => {
    try {
      setEntries(await listTrash());
    } catch {}
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useFsWatch("~/.local/share/aqua/Trash", () => void load());
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
      <FiTrash2 className="text-2xl text-text-tertiary" aria-hidden="true" />
      <p className="text-sm text-text-secondary">
        {entries.length} {entries.length === 1 ? "item" : "items"}
      </p>
      <button
        className="mt-1 rounded-full bg-bg-hover px-3 py-1 text-xs text-text-primary hover:bg-bg-hover/80 disabled:opacity-40"
        disabled={!entries.length}
        onClick={() =>
          requestConfirm({
            title: "Empty Trash?",
            body: `Remove ${entries.length} items permanently?`,
            confirmLabel: "Empty Trash",
            danger: true,
            onConfirm: () =>
              void emptyTrash()
                .then(() => {
                  toast.success("Trash emptied.");
                  void load();
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't empty Trash")),
          })
        }
      >
        Empty Trash
      </button>
    </div>
  );
}
