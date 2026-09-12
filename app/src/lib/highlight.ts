import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

export type Highlighter = (code: string, lang: string) => string;

/**
 * Lazy Prism bridge. This module is only ever imported via a dynamic import
 * from MarkdownRenderer, so its bundle (Prism core + the language grammars
 * above) never loads unless the open document contains a fenced code block.
 * Returning an empty string for an unknown language makes markdown-it fall
 * back to its own escaping, so unrecognized fences still render safely.
 */
export function loadHighlighter(): Highlighter {
  const languages = Prism.languages;
  return (code, lang) => {
    const grammar = lang ? languages[lang] : undefined;
    if (!grammar) return "";
    return Prism.highlight(code, grammar, lang);
  };
}
