import { create } from "zustand";
import type { ImageSortKey, ThumbSize } from "./galleryUtils";

/**
 * UI state the focused-window menu bar needs to read and drive. The pane owns
 * its data; this store only mirrors what menus render (size, sort) plus a
 * has-selection flag so the Image menu can disable itself.
 */
interface GalleryUiState {
  thumbSize: ThumbSize;
  sortBy: ImageSortKey;
  sortAscending: boolean;
  hasSelection: boolean;
  setThumbSize: (size: ThumbSize) => void;
  setSort: (key: ImageSortKey, ascending: boolean) => void;
  setHasSelection: (value: boolean) => void;
}

export const useGalleryUiStore = create<GalleryUiState>((set) => ({
  thumbSize: "m",
  sortBy: "name",
  sortAscending: true,
  hasSelection: false,
  setThumbSize: (thumbSize) => set({ thumbSize }),
  setSort: (sortBy, sortAscending) => set({ sortBy, sortAscending }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
}));

/** Menu-bar → pane action channel (same CustomEvent pattern as Dock context). */
export type GalleryMenuAction = "rename" | "moveToTrash" | "reveal" | "info";

export function dispatchGalleryAction(action: GalleryMenuAction): void {
  window.dispatchEvent(new CustomEvent("aqua-gallery-action", { detail: { action } }));
}
