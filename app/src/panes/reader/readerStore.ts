import { create } from "zustand";

/**
 * UI state the focused-window menu bar needs to read and drive. The pane owns
 * the document; this store mirrors the two facts menus care about — whether a
 * document is open (enables the File/Edit actions) and the TOC sidebar toggle.
 */
interface ReaderUiState {
  hasDocument: boolean;
  tocOpen: boolean;
  setHasDocument: (value: boolean) => void;
  toggleToc: () => void;
}

export const useReaderUiStore = create<ReaderUiState>((set) => ({
  hasDocument: false,
  tocOpen: true,
  setHasDocument: (hasDocument) => set({ hasDocument }),
  toggleToc: () => set((s) => ({ tocOpen: !s.tocOpen })),
}));

/** Menu-bar → pane action channel (same CustomEvent pattern as Gallery/Dock). */
export type ReaderMenuAction =
  | "rename"
  | "duplicate"
  | "moveToTrash"
  | "revealInFinder"
  | "copyAsMarkdown"
  | "copyAsPlainText"
  | "toggleToc"
  | "print";

export function dispatchReaderAction(action: ReaderMenuAction): void {
  window.dispatchEvent(new CustomEvent("aqua-reader-action", { detail: { action } }));
}
