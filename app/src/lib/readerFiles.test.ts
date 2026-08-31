import { describe, expect, it } from "vitest";
import { isReaderSupportedFile, readerKindForFile } from "./readerFiles";

describe("readerKindForFile", () => {
  it("maps Markdown and PDF extensions case-insensitively", () => {
    expect(readerKindForFile("README.md")).toBe("markdown");
    expect(readerKindForFile("notes.MARKDOWN")).toBe("markdown");
    expect(readerKindForFile("guide.PDF")).toBe("pdf");
  });

  it("rejects unsupported document types", () => {
    expect(readerKindForFile("notes.txt")).toBeNull();
    expect(isReaderSupportedFile("photo.png")).toBe(false);
  });
});
