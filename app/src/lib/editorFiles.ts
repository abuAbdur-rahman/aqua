export const editableExtensions = [
  "txt", "md", "mdx", "json", "jsonc", "yaml", "yml", "toml", "ini", "env",
  "js", "jsx", "ts", "tsx", "css", "scss", "html", "xml", "svg", "py", "rs",
  "go", "java", "c", "h", "cpp", "hpp", "sh", "bash", "zsh", "fish", "sql",
  "graphql", "vue", "svelte", "log",
] as const;

// Dotfiles without a conventional extension are matched by full name.
const editableDotfiles = new Set([
  ".bashrc", ".bash_profile", ".bash_logout", ".zshrc", ".zprofile",
  ".zlogin", ".profile", ".inputrc", ".gitignore", ".gitattributes",
  ".editorconfig", ".npmrc",
]);

export type EditorFileState = "editable" | "uneditable";

function basenameOf(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

// Returns the extension, or the full name for a bare dotfile (e.g. ".bashrc").
function nameKey(path: string): string {
  const name = basenameOf(path);
  if (name.startsWith(".") && name.indexOf(".", 1) === -1) return name;
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function editorFileState(path: string): EditorFileState {
  const name = basenameOf(path);
  if (name === ".env" || name.startsWith(".env.") || editableDotfiles.has(name)) return "editable";
  const key = nameKey(path);
  return key && editableExtensions.includes(key as (typeof editableExtensions)[number])
    ? "editable"
    : "uneditable";
}

export function languageForFile(path: string) {
  const name = basenameOf(path);
  const dotfileLanguages: Record<string, string> = {
    ".bashrc": "shell", ".bash_profile": "shell", ".bash_logout": "shell",
    ".zshrc": "shell", ".zprofile": "shell", ".zlogin": "shell", ".profile": "shell",
    ".inputrc": "shell", ".gitconfig": "ini", ".editorconfig": "ini", ".npmrc": "ini",
    ".gitignore": "plaintext", ".gitattributes": "plaintext",
  };
  if (dotfileLanguages[name]) return dotfileLanguages[name];
  const extension = name.split(".").pop()?.toLowerCase();
  const languages: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    rs: "rust", py: "python", json: "json", jsonc: "json", md: "markdown", mdx: "markdown",
    css: "css", scss: "scss", html: "html", xml: "xml", yml: "yaml", yaml: "yaml",
    toml: "ini", ini: "ini", sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
    sql: "sql", graphql: "graphql", vue: "vue", svelte: "svelte", log: "plaintext",
  };
  return (extension && languages[extension]) ?? "plaintext";
}
