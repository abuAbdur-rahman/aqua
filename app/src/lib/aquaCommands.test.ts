import { describe, expect, it } from "vitest";
import {
  AQUA_SHELL_FUNCTION,
  AQUA_COMMANDS,
  aquaEventName,
  parseAquaCommand,
  PATH_TARGETS,
} from "./aquaCommands";

describe("parseAquaCommand", () => {
  it("maps every path-taking app", () => {
    expect(parseAquaCommand("edit")?.target).toBe("editor");
    expect(parseAquaCommand("finder")?.target).toBe("finder");
    expect(parseAquaCommand("gallery")?.target).toBe("gallery");
    expect(parseAquaCommand("reader")?.target).toBe("reader");
    expect(parseAquaCommand("terminal")?.target).toBe("terminal");
  });

  it("maps every path-less app", () => {
    expect(parseAquaCommand("activity")?.target).toBe("activity");
    expect(parseAquaCommand("settings")?.target).toBe("settings");
    expect(parseAquaCommand("trash")?.target).toBe("trash");
  });

  it("rejects unknown commands and trims whitespace", () => {
    expect(parseAquaCommand("slack")).toBeNull();
    expect(parseAquaCommand("")).toBeNull();
    expect(parseAquaCommand("  reader  ")?.target).toBe("reader");
  });
});

describe("aquaEventName", () => {
  it("prefixes the target with the aqua:open- event namespace", () => {
    expect(aquaEventName("reader")).toBe("aqua:open-reader");
    expect(aquaEventName("settings")).toBe("aqua:open-settings");
  });
});

describe("shell function", () => {
  it("covers exactly the TS parser's command names", () => {
    for (const command of Object.keys(AQUA_COMMANDS)) {
      expect(AQUA_SHELL_FUNCTION).toContain(command);
    }
  });

  it("marks exactly the same apps as path-taking as PATH_TARGETS", () => {
    // The shell case-arm for path-taking apps must use the same commands as
    // the commands whose target lands in PATH_TARGETS.
    const pathArm = AQUA_SHELL_FUNCTION.slice(
      AQUA_SHELL_FUNCTION.indexOf("edit|finder"),
      AQUA_SHELL_FUNCTION.indexOf("activity|settings|trash"),
    );
    const pathTakingCommands = Object.entries(AQUA_COMMANDS)
      .filter(([, target]) => PATH_TARGETS.has(target))
      .map(([command]) => command);
    const pathLessCommands = Object.entries(AQUA_COMMANDS)
      .filter(([, target]) => !PATH_TARGETS.has(target))
      .map(([command]) => command);
    for (const command of pathTakingCommands) {
      expect(pathArm).toContain(command);
    }
    for (const command of pathLessCommands) {
      expect(pathArm).not.toContain(command);
    }
  });

  it("defines the function and exports it", () => {
    expect(AQUA_SHELL_FUNCTION).toContain("function aqua()");
    expect(AQUA_SHELL_FUNCTION).toContain("export -f aqua");
  });
});
