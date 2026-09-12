export interface PickedImage {
  name: string;
  /** Base64-encoded file bytes (the Rust command ships them that way). */
  data_base64: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function labelFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function mimeFromName(name: string): string {
  return MIME_BY_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/**
 * Native multi-file picker with a browser fallback. In Tauri the Rust host
 * owns the real Windows dialog (`pick_images` command); in plain `vite dev` a
 * hidden multi-select file input stands in so the pane stays testable outside
 * the shell. Blobs always carry an explicit MIME type — the daemon validates
 * uploads by decoding, and a typeless body makes debugging harder.
 */
export async function pickImages(): Promise<Array<{ blob: Blob; label: string }>> {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    const picked = await invoke<PickedImage[] | null>("pick_images");
    if (!picked || picked.length === 0) return [];
    return picked.map((p) => ({
      blob: new Blob([base64ToBytes(p.data_base64) as BlobPart], { type: mimeFromName(p.name) }),
      label: labelFromName(p.name),
    }));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      resolve(files.map((file) => ({ blob: file, label: labelFromName(file.name) })));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
