import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

export interface TocHeading {
  level: number;
  text: string;
}

export type HighlightFn = (code: string, lang: string) => string;

export const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.test(name);
}

// A document containing a fence pays for the Prism chunk; a document without
// one never imports it (UI-SPEC-16 §3 — the common case stays cheap).
export function hasFencedCode(markdown: string): boolean {
  return /```|~~~/.test(markdown);
}

// html:false escapes raw HTML instead of rendering it — the reader shows the
// markup, never executes it. Tables + strikethrough are in markdown-it's core;
// linkify adds GFM bare-URL autolinks; task lists need the small plugin.
const md = new MarkdownIt({
  html: false,
  linkify: true,
});
md.use(taskLists, { enabled: true, label: true, labelAfter: false });

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[\\*_~`]/g, "")
    .trim();
}

/**
 * Extracts the rendered document's headings for the TOC sidebar. Walks the
 * markdown-it token stream rather than scanning raw lines, so it matches
 * exactly what renders (ATX and setext headings) and never counts a heading
 * that's actually inside a fenced code block.
 */
export function parseToc(markdown: string): TocHeading[] {
  const tokens = md.parse(markdown, {});
  const headings: TocHeading[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const level = Number(token.tag.slice(1));
    const inline = tokens[i + 1];
    const text = inline && inline.type === "inline" ? stripInline(inline.content) : "";
    if (!text) continue;
    headings.push({ level, text });
  }
  return headings;
}

export function renderMarkdown(markdown: string, highlight?: HighlightFn): string {
  if (highlight) {
    md.options.highlight = highlight;
    const html = md.render(markdown);
    md.options.highlight = null;
    return html;
  }
  return md.render(markdown);
}

// Renders once, then strips tags and decodes the handful of entities markdown-it
// emits. Pure string work — no DOM, so it's testable anywhere and cheap.
export function markdownToPlainText(markdown: string): string {
  const html = md.render(markdown);
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?([.,;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
