export interface PickedImage {
  name: string;
  data: Uint8Array;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

function labelFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Native file picker with a browser fallback. In Tauri the Rust host owns the
 * real Windows dialog (`pick_image` command); in plain `vite dev` a hidden
 * file input stands in so the pane stays testable outside the shell.
 */
export async function pickImage(): Promise<{ blob: Blob; label: string } | null> {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    const picked = await invoke<PickedImage | null>("pick_image");
    if (!picked) return null;
    return {
      blob: new Blob([picked.data as BlobPart]),
      label: labelFromName(picked.name),
    };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? { blob: file, label: labelFromName(file.name) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
