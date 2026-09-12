import { describe, expect, it } from "vitest";
import {
  hasFencedCode,
  isMarkdownFileName,
  markdownToPlainText,
  parseToc,
  renderMarkdown,
} from "./markdown";

describe("isMarkdownFileName", () => {
  it("accepts .md and .markdown, case-insensitively", () => {
    expect(isMarkdownFileName("README.md")).toBe(true);
    expect(isMarkdownFileName("CHANGES.markdown")).toBe(true);
    expect(isMarkdownFileName("README.MD")).toBe(true);
  });

  it("rejects other extensions", () => {
    expect(isMarkdownFileName("notes.txt")).toBe(false);
    expect(isMarkdownFileName("index.html")).toBe(false);
    expect(isMarkdownFileName("md")).toBe(false);
  });
});

describe("renderMarkdown", () => {
  it("renders GFM tables", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("renders task lists with checkboxes", () => {
    const html = renderMarkdown("- [ ] todo\n- [x] done");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("renders strikethrough", () => {
    const html = renderMarkdown("~~gone~~");
    expect(html).toContain("<s>gone</s>");
  });

  it("linkifies bare URLs (GFM autolinks)", () => {
    const html = renderMarkdown("see https://example.com/x now");
    expect(html).toContain('<a href="https://example.com/x"');
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("applies the highlight callback to fenced code when provided", () => {
    const html = renderMarkdown("```ts\nconst x = 1;\n```", (code, lang) => {
      expect(lang).toBe("ts");
      return `<span class="tok">${code}</span>`;
    });
    // markdown-it passes the fence content with its trailing newline intact.
    expect(html).toContain('<span class="tok">const x = 1;');
  });

  it("escapes fenced code when no highlighter is provided", () => {
    const html = renderMarkdown("```html\n<div>x</div>\n```");
    expect(html).toContain("&lt;div&gt;x&lt;/div&gt;");
  });
});

describe("parseToc", () => {
  it("extracts ATX headings in document order", () => {
    const toc = parseToc("# One\n## Two\n### Three\n# Four");
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "One"],
      [2, "Two"],
      [3, "Three"],
      [1, "Four"],
    ]);
  });

  it("extracts setext headings", () => {
    const toc = parseToc("Title\n=====\n\nSub\n---");
    expect(toc.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, "Sub"],
    ]);
  });

  it("strips inline formatting from heading text", () => {
    const toc = parseToc("# **Bold** and `code` and [link](https://x)");
    expect(toc[0].text).toBe("Bold and code and link");
  });

  it("ignores headings inside fenced code blocks", () => {
    const toc = parseToc("# Real\n```md\n# Fake\n```");
    expect(toc.map((h) => h.text)).toEqual(["Real"]);
  });
});

describe("markdownToPlainText", () => {
  it("strips markup into readable plain text", () => {
    const text = markdownToPlainText("# Title\n\nSome **bold** and `code` and [a link](https://x).");
    expect(text).toContain("Title");
    expect(text).toContain("Some bold and code and a link.");
  });

  it("decodes entities", () => {
    const text = markdownToPlainText("a &lt; b &amp; c");
    expect(text).toContain("a < b & c");
  });
});

describe("hasFencedCode", () => {
  it("detects backtick and tilde fences", () => {
    expect(hasFencedCode("```js\nx\n```")).toBe(true);
    expect(hasFencedCode("~~~\nyaml\n~~~")).toBe(true);
  });

  it("returns false for plain prose", () => {
    expect(hasFencedCode("no code here")).toBe(false);
  });
});
