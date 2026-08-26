import { describe, expect, it } from "vitest";
import {
  base64ToBlob,
  breadcrumbs,
  describeEntry,
  formatSize,
  isImageFile,
  LARGE_FILE_BYTES,
  mimeForExtension,
  parentOf,
  sortImages,
  type ImageSortKey,
} from "./galleryUtils";
import type { FsEntry } from "../../lib/filesystem";

function entry(overrides: Partial<FsEntry> = {}): FsEntry {
  return {
    name: "a.png",
    path: "/home/a.png",
    kind: "file",
    size: 100,
    modified: "2026-01-01T00:00:00Z",
    permissions: "rw-r--r--",
    isTrashable: true,
    ...overrides,
  };
}

describe("isImageFile", () => {
  it("accepts supported image extensions", () => {
    for (const name of ["a.jpg", "b.JPEG", "c.png", "d.gif", "e.webp", "f.bmp", "g.svg"]) {
      expect(isImageFile(entry({ name }))).toBe(true);
    }
  });

  it("rejects non-image files and directories", () => {
    expect(isImageFile(entry({ name: "notes.txt" }))).toBe(false);
    expect(isImageFile(entry({ name: "photo.png", kind: "dir" }))).toBe(false);
    expect(isImageFile(entry({ name: "link.png", kind: "symlink" }))).toBe(false);
  });
});

describe("mimeForExtension", () => {
  it("maps known extensions to image mimes", () => {
    expect(mimeForExtension("a.jpg")).toBe("image/jpeg");
    expect(mimeForExtension("a.PNG")).toBe("image/png");
    expect(mimeForExtension("a.svg")).toBe("image/svg+xml");
  });

  it("falls back to octet-stream", () => {
    expect(mimeForExtension("a.weird")).toBe("application/octet-stream");
    expect(mimeForExtension("noext")).toBe("application/octet-stream");
  });
});

describe("sortImages", () => {
  const images: FsEntry[] = [
    entry({ name: "c.png", size: 30, modified: "2026-03-01T00:00:00Z" }),
    entry({ name: "a.png", size: 20, modified: "2026-01-01T00:00:00Z" }),
    entry({ name: "b.png", size: 10, modified: "2026-02-01T00:00:00Z" }),
  ];

  const orders: Array<[ImageSortKey, string[]]> = [
    ["name", ["a.png", "b.png", "c.png"]],
    ["size", ["b.png", "a.png", "c.png"]],
    ["modified", ["a.png", "b.png", "c.png"]],
  ];

  it.each(orders)("sorts ascending by %s without mutating input", (key, expected) => {
    const sorted = sortImages(images, key, true);
    expect(sorted.map((image) => image.name)).toEqual(expected);
    expect(images.map((image) => image.name)).toEqual(["c.png", "a.png", "b.png"]);
  });

  it("reverses order when descending", () => {
    expect(sortImages(images, "name", false).map((image) => image.name)).toEqual(["c.png", "b.png", "a.png"]);
  });
});

describe("formatSize", () => {
  it("formats bytes, KB, and MB", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(LARGE_FILE_BYTES)).toBe("8.0 MB");
  });
});

describe("parentOf", () => {
  it("returns the parent directory", () => {
    expect(parentOf("/home/user/pic.png")).toBe("/home/user");
    expect(parentOf("./pics/pic.png")).toBe("./pics");
  });

  it("keeps home at home", () => {
    expect(parentOf(".")).toBe(".");
    expect(parentOf("/")).toBe("/");
  });
});

describe("breadcrumbs", () => {
  it("anchors home first for nested paths", () => {
    const crumbs = breadcrumbs("./Pictures/cats");
    expect(crumbs[0]).toEqual({ label: "Home", path: "." });
    expect(crumbs.map((crumb) => crumb.label)).toEqual(["Home", "Pictures", "cats"]);
    expect(crumbs[2].path).toBe("./Pictures/cats");
  });

  it("handles absolute paths and plain home", () => {
    expect(breadcrumbs("/etc/nginx")[1].path).toBe("/etc");
    expect(breadcrumbs(".")).toEqual([{ label: "Home", path: "." }]);
  });
});

describe("describeEntry", () => {
  it("includes name, size, and permissions", () => {
    const text = describeEntry(entry());
    expect(text).toContain("a.png");
    expect(text).toContain("100 B");
    expect(text).toContain("rw-r--r--");
  });
});

describe("base64ToBlob", () => {
  it("round-trips base64 payload with the given mime type", async () => {
    // "hi" encoded
    const blob = base64ToBlob(btoa("hi"), "image/png");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(2);
    expect(await blob.text()).toBe("hi");
  });
});
