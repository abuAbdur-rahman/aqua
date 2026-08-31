export type ReaderKind = "markdown" | "pdf";

export const PDF_PREVIEW_LIMIT_BYTES = 8 * 1024 * 1024;

export function readerKindForFile(name: string): ReaderKind | null {
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.pdf$/i.test(name)) return "pdf";
  return null;
}

export function isReaderSupportedFile(name: string): boolean {
  return readerKindForFile(name) !== null;
}
