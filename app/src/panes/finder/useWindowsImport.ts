import { useCallback, useRef, useState } from "react";
import { useToastStore } from "../../system/toast";

// Same in-flight cap as Gallery's fs/read queue — reusing the number, not
// inventing a second concurrency policy.
const IMPORT_CONCURRENCY = 6;

async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(cmd, args);
}

async function copyWindowsPath(sourcePath: string, destinationPath: string): Promise<void> {
  await invokeSafe<void>("import_from_windows", { sourcePath, destinationPath });
}

/**
 * "Import from Windows..." flow: native dialog → host-translated /mnt/* paths
 * → daemon `copy` into the folder Finder currently has open. Progress shows as
 * one toast updated per completed file; a single failing file surfaces its own
 * error without blocking the rest of the batch. No cancel in v1 (deliberate).
 */
export function useWindowsImport(destination: () => string, onDone: () => void) {
  const [importing, setImporting] = useState(false);
  const busyRef = useRef(false);
  const destinationRef = useRef(destination);
  const onDoneRef = useRef(onDone);
  destinationRef.current = destination;
  onDoneRef.current = onDone;

  const importFromWindows = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setImporting(true);

    const { push, dismiss } = useToastStore.getState();
    let progressId: number | undefined;
    try {
      const picked = await invokeSafe<string[]>("pick_windows_files");
      if (picked.length === 0) return;

      let completed = 0;
      let failed = 0;
      const total = picked.length;
      const showProgress = () => {
        if (progressId !== undefined) dismiss(progressId);
        progressId = push("info", `Copying ${completed} of ${total}…`, 120_000).id ?? undefined;
        return progressId;
      };
      showProgress();

      const errors = new Map<string, string>();
      const queue = [...picked];
      const worker = async () => {
        for (;;) {
          const source = queue.shift();
          if (source === undefined) return;
          try {
            await copyWindowsPath(source, destinationRef.current());
          } catch (cause: unknown) {
            failed += 1;
            errors.set(
              source,
              cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "Copy failed",
            );
          }
          completed += 1;
          showProgress();
        }
      };

      await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, total) }, worker));

      if (progressId !== undefined) dismiss(progressId);
      if (failed === 0) {
        push("success", total === 1 ? "Imported 1 item." : `Imported ${total} items.`);
      } else {
        const first = [...errors.entries()][0];
        push(
          "error",
          first
            ? `Couldn't import ${first[0]}: ${first[1]}`
            : `${failed} of ${total} items couldn't be imported.`,
          6000,
        );
      }
      onDoneRef.current();
    } catch (cause: unknown) {
      if (progressId !== undefined) dismiss(progressId);
      push("error", cause instanceof Error ? cause.message : "Import from Windows failed.", 6000);
    } finally {
      busyRef.current = false;
      setImporting(false);
    }
  }, []);

  return { importing, importFromWindows };
}
