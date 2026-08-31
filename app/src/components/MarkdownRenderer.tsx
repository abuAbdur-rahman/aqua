import { useEffect, useMemo, useRef, useState } from "react";
import { hasFencedCode, renderMarkdown, type HighlightFn } from "../lib/markdown";

interface MarkdownRendererProps {
  markdown: string;
  /** compact: Finder Quick Look style — tighter type, no hover affordances */
  compact?: boolean;
  className?: string;
}

// The copy glyph is a text character (like the traffic-light ×/–), avoiding a
// DOM-injected SVG or a react-dom/server round trip inside the hot component.
const COPY_GLYPH = "⧉";
const CHECK_GLYPH = "✓";

// Delegated copy for injected code-block buttons. Reading the <code> text
// gives the raw source (the span tree carries no extra whitespace), so what
// lands on the clipboard is exactly what was in the fence.
function onCopyClick(event: React.MouseEvent<HTMLDivElement>) {
  const button = (event.target as HTMLElement).closest("[data-copy-code]");
  if (!button) return;
  event.stopPropagation();
  const pre = button.parentElement;
  const code = pre?.querySelector("code");
  const text = code?.textContent ?? "";
  if (!text) return;
  const original = button.innerHTML;
  void navigator.clipboard
    ?.writeText(text)
    .then(() => {
      button.innerHTML = `<span aria-hidden="true">${CHECK_GLYPH}</span>`;
      button.classList.add("md-copied");
      window.setTimeout(() => {
        button.innerHTML = original;
        button.classList.remove("md-copied");
      }, 1000);
    })
    .catch(() => {});
}

export function MarkdownRenderer({ markdown, compact = false, className }: MarkdownRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const needsHighlight = useMemo(() => hasFencedCode(markdown), [markdown]);
  const [highlighter, setHighlighter] = useState<HighlightFn | null>(null);

  // The common case (no code fences) never imports the Prism chunk. When a
  // fence exists, load it once and re-render in place — the added spans don't
  // change layout, so scroll position survives the upgrade.
  useEffect(() => {
    if (!needsHighlight || highlighter) return;
    let disposed = false;
    void import("../lib/highlight")
      .then(({ loadHighlighter }) => {
        if (!disposed) setHighlighter(() => loadHighlighter());
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [needsHighlight, highlighter]);

  const html = useMemo(
    () => renderMarkdown(markdown, highlighter ?? undefined),
    [markdown, highlighter],
  );

  // Inject the per-block copy button after every render. React owns the inner
  // HTML; the button is appended inside each <pre>, keyed by a data attribute
  // so re-renders never stack duplicates.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    for (const pre of root.querySelectorAll("pre")) {
      if (pre.querySelector("[data-copy-code]")) continue;
      if (!pre.querySelector("code")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "md-copy";
      button.dataset.copyCode = "";
      button.setAttribute("aria-label", "Copy code");
      button.innerHTML = `<span aria-hidden="true">${COPY_GLYPH}</span>`;
      pre.appendChild(button);
    }
  }, [html]);

  return (
    <div
      ref={rootRef}
      className={`markdown-body ${compact ? "markdown-compact" : ""} ${className ?? ""}`}
      onClick={onCopyClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
