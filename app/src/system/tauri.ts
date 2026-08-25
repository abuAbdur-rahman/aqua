// Shared Tauri IPC helper. Resolves to null outside the Tauri shell (plain
// `vite dev`) or when a command fails, so panes can degrade instead of crash.
export async function tauriInvoke<T>(cmd: string): Promise<T | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd);
  } catch {
    return null;
  }
}

// Same boundary as tauriInvoke, but propagates command failures so callers
// that must surface errors (e.g. the WSL distro restart) can.
export async function tauriInvokeStrict<T>(cmd: string): Promise<T> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Not running inside the Aqua shell");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(cmd);
}
