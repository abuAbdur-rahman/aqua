export type AquaTarget =
  | "editor"
  | "finder"
  | "gallery"
  | "reader"
  | "terminal"
  | "activity"
  | "settings"
  | "trash";

// Apps that accept an optional target path; the rest are path-less launches.
export const PATH_TARGETS: ReadonlySet<AquaTarget> = new Set([
  "editor",
  "finder",
  "gallery",
  "reader",
  "terminal",
]);

const COMMAND_TO_TARGET: Record<string, AquaTarget> = {
  edit: "editor",
  finder: "finder",
  gallery: "gallery",
  reader: "reader",
  terminal: "terminal",
  activity: "activity",
  settings: "settings",
  trash: "trash",
};

// Read-only view for tests that verify the bash function stays in lockstep.
export const AQUA_COMMANDS: Readonly<Record<string, AquaTarget>> = COMMAND_TO_TARGET;

export interface AquaCommand {
  target: AquaTarget;
}

export function parseAquaCommand(rawCommand: string): AquaCommand | null {
  const target = COMMAND_TO_TARGET[rawCommand.trim()];
  return target ? { target } : null;
}

export function aquaEventName(target: AquaTarget): string {
  return `aqua:open-${target}`;
}

export const AQUA_USAGE =
  "Usage: aqua <app> [path] — apps: edit | finder | gallery | reader | terminal | activity | settings | trash";

/**
 * The bash `aqua` function injected into every new shell. Kept in lockstep
 * with `parseAquaCommand` above: same app names, same OSC 777 protocol, so a
 * command works identically whether it resolves in the shell or in the UI.
 */
export const AQUA_SHELL_FUNCTION = `function aqua(){ local app="$1"; local p="$2"; case "$app" in edit|finder|gallery|reader|terminal) [[ -n "$p" && "$p" != /* ]] && p="$PWD/\${p#./}"; printf '\\033]777;%s;%s\\007' "$app" "\${p:-}";; activity|settings|trash) printf '\\033]777;%s;\\007' "$app";; *) echo '${AQUA_USAGE}' ;; esac; }; export -f aqua;`;
