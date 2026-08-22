export const editableExtensions = [
  "txt", "md", "mdx", "json", "jsonc", "yaml", "yml", "toml", "ini", "env",
  "js", "jsx", "ts", "tsx", "css", "scss", "html", "xml", "svg", "py", "rs",
  "go", "java", "c", "h", "cpp", "hpp", "sh", "bash", "zsh", "fish", "sql",
  "graphql", "vue", "svelte",
] as const;

export type EditorFileState = "editable" | "uneditable";

export function editorFileState(path: string): EditorFileState {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  if (name === ".env" || name.startsWith(".env.")) return "editable";
  const extension = name.split(".").pop()?.toLowerCase();
  return extension && editableExtensions.includes(extension as (typeof editableExtensions)[number])
    ? "editable"
    : "uneditable";
}

export function languageForFile(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    rs: "rust", py: "python", json: "json", jsonc: "json", md: "markdown", mdx: "markdown",
    css: "css", scss: "scss", html: "html", xml: "xml", yml: "yaml", yaml: "yaml",
    toml: "ini", ini: "ini", sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
    sql: "sql", graphql: "graphql", vue: "vue", svelte: "svelte",
  };
  return (extension && languages[extension]) ?? "plaintext";
}
