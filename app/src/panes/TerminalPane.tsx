import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { FiClipboard, FiPlus, FiX } from "react-icons/fi";
import { createResizeScheduler, openPtySession, type PtySession } from "../lib/pty";
import { useWindowStore } from "../windows/store";

type TabState = "spawning" | "connected" | "exited" | "disconnected";

interface TerminalTab {
  id: string;
  label: string;
  state: TabState;
  exitCode?: number;
  restartKey: number;
}

interface TerminalSurfaceProps {
  tab: TerminalTab;
  active: boolean;
  fontSize: number;
  cwd?: string;
  terminalsRef: React.MutableRefObject<Map<string, Terminal>>;
  onStateChange: (state: TabState, exitCode?: number) => void;
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  return {
    background: token("--bg-surface"),
    foreground: token("--text-primary"),
    cursor: token("--accent"),
    cursorAccent: token("--bg-surface"),
    selectionBackground: token("--accent-bg"),
    black: token("--bg-base"),
    red: token("--status-danger"),
    green: token("--status-success"),
    yellow: token("--status-warning"),
    blue: token("--status-info"),
    magenta: token("--accent-strong"),
    cyan: token("--accent"),
    white: token("--text-primary"),
    brightBlack: token("--text-tertiary"),
    brightRed: token("--status-danger"),
    brightGreen: token("--status-success"),
    brightYellow: token("--status-warning"),
    brightBlue: token("--status-info"),
    brightMagenta: token("--accent-strong"),
    brightCyan: token("--accent-strong"),
    brightWhite: token("--text-primary"),
  };
}

function TerminalSurface({ tab, active, fontSize, cwd, terminalsRef, onStateChange }: TerminalSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<PtySession | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createResizeScheduler> | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({
      convertEol: true,
      cursorStyle: "block",
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
      fontSize,
      theme: terminalTheme(),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    terminal.open(host);
    terminalRef.current = terminal;
    terminalsRef.current.set(tab.id, terminal);

    // Output is discarded until the shell confirms the silent `aqua` setup
    // finished (OSC 777 "ready") — otherwise the echoed setup commands flash
    // on every open. The timeout guards against shells that never answer.
    let buffering = true;
    const stopBuffering = () => {
      buffering = false;
    };
    const readyTimer = window.setTimeout(stopBuffering, 3000);

    const input = terminal.onData((data) => sessionRef.current?.sendInput(new TextEncoder().encode(data)));
    const binaryInput = terminal.onBinary((data) => sessionRef.current?.sendInput(Uint8Array.from(data, (char) => char.charCodeAt(0))));
    const osc = terminal.parser.registerOscHandler(777, (data) => {
      const [command, encodedPath] = data.split(";", 2);
      if (command === "ready") {
        window.clearTimeout(readyTimer);
        stopBuffering();
        return true;
      }
      const path = encodedPath ? decodeURIComponent(encodedPath) : "";
      if ((command === "edit" || command === "finder") && path) {
        window.dispatchEvent(new CustomEvent(command === "edit" ? "aqua:open-editor" : "aqua:open-finder", { detail: path }));
      }
      return true;
    });
    const selectionCopy = terminal.onSelectionChange(() => {
      const text = terminal.getSelection();
      if (text) navigator.clipboard?.writeText(text).catch(() => {});
    });

    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      fit.fit();
      schedulerRef.current?.schedule(terminal.cols, terminal.rows);
    };
    schedulerRef.current = createResizeScheduler((cols, rows) => sessionRef.current?.resize(cols, rows));
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let cancelled = false;
    void openPtySession({
      cols: terminal.cols || 80,
      rows: terminal.rows || 24,
      ...(cwd ? { cwd } : {}),
      onOutput: (data) => {
        if (buffering) return;
        terminal.write(data);
      },
      onExit: ({ code }) => {
        terminal.writeln(`\r\n[Process exited with code ${code}]`);
        onStateChangeRef.current("exited", code);
      },
      onDisconnect: () => onStateChangeRef.current("disconnected"),
    }).then((session) => {
      if (cancelled) {
        session.dispose();
        return;
      }
      sessionRef.current = session;
      onStateChangeRef.current("connected");
      // stty -echo first so the function definition never echoes; the ready
      // marker lifts the output buffer, then clear gives a clean prompt.
      session.sendInput(new TextEncoder().encode("stty -echo\n"));
      session.sendInput(new TextEncoder().encode("function aqua(){ case \"$1\" in edit|finder) local p=\"$2\"; [[ \"$p\" != /* ]] && p=\"$PWD/${p#./}\"; printf '\\033]777;%s;%s\\007' \"$1\" \"$p\" ;; *) echo 'Usage: aqua edit <path> | aqua finder <path>' ;; esac; }; export -f aqua; clear; stty echo; printf '\\033]777;ready\\007'\n"));
      resize();
    }).catch(() => {
      if (!cancelled) onStateChangeRef.current("disconnected");
    });

    return () => {
      cancelled = true;
      window.clearTimeout(readyTimer);
      observer.disconnect();
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      sessionRef.current?.dispose();
      sessionRef.current = null;
      input.dispose();
      binaryInput.dispose();
      osc.dispose();
      selectionCopy.dispose();
      terminal.dispose();
      terminalRef.current = null;
      terminalsRef.current.delete(tab.id);
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.options.cursorStyle = active ? "block" : "underline";
  }, [active]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = fontSize;
    // The renderer re-measures glyph metrics asynchronously after a font-size
    // change — fitting synchronously uses stale metrics and corrupts the grid
    // (TUI apps like tmux render zoomed/broken). Re-fit once the renderer has
    // settled, then push the new cols/rows to the pty without the debounce so
    // full-screen apps repaint at the correct size immediately.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const fit = fitRef.current;
        if (!fit) return;
        fit.fit();
        terminal.refresh(0, terminal.rows - 1);
        sessionRef.current?.resize(terminal.cols, terminal.rows);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [fontSize]);

  return (
    <div className={`absolute inset-0 p-2 ${active ? "block" : "hidden"}`} aria-hidden={!active}>
      <div ref={hostRef} className="h-full w-full" />
      {tab.state === "spawning" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-tertiary">Starting shell...</div>}
      {tab.state === "disconnected" && <div className="absolute inset-0 flex items-center justify-center bg-bg-overlay/60 text-xs text-text-secondary">Connection lost - reconnecting...</div>}
      {tab.state === "exited" && <button className="absolute bottom-3 left-3 text-xs text-accent hover:text-accent-strong" onClick={() => onStateChange("spawning")}>Restart</button>}
    </div>
  );
}

let tabSequence = 1;
function newTab(): TerminalTab {
  const id = `terminal-tab-${tabSequence++}`;
  return { id, label: "bash", state: "spawning", restartKey: 0 };
}

export function TerminalPane() {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [fontSize, setFontSize] = useState(12);
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const terminalPathRequest = useWindowStore((state) => state.terminalPathRequest);
  const clearTerminalPathRequest = useWindowStore((state) => state.clearTerminalPathRequest);

  const updateTab = (id: string, state: TabState, exitCode?: number) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, state, ...(state === "spawning" ? { restartKey: tab.restartKey + 1 } : {}), ...(exitCode === undefined ? {} : { exitCode }) } : tab));
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (id === activeId) setActiveId(next[Math.max(0, index - 1)].id);
  };

   useEffect(() => {
     const onKeyDown = (event: KeyboardEvent) => {
       if (!event.ctrlKey || event.altKey || event.metaKey) return;
       if (event.key === "+" || event.key === "=") {
         event.preventDefault();
         setFontSize((size) => Math.min(24, size + 1));
       } else if (event.key === "-") {
         event.preventDefault();
         setFontSize((size) => Math.max(8, size - 1));
       } else if (event.key.toLowerCase() === "c" && event.shiftKey) {
        const terminal = terminalsRef.current.get(activeId);
        const text = terminal?.getSelection();
        if (text) {
          event.preventDefault();
          navigator.clipboard?.writeText(text).catch(() => {});
        }
      }
     };
     window.addEventListener("keydown", onKeyDown);
     return () => window.removeEventListener("keydown", onKeyDown);
   }, [activeId]);

  useEffect(() => {
    if (terminalPathRequest) clearTerminalPathRequest();
  }, [clearTerminalPathRequest, terminalPathRequest]);

  const copySelection = () => {
    const terminal = terminalsRef.current.get(activeId);
    const text = terminal?.getSelection();
    if (text) navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-bg-surface font-mono text-xs">
      <div className="z-10 flex h-7 shrink-0 items-center gap-1 border-b border-bg-hover bg-bg-elevated px-1" role="tablist" aria-label="Terminal tabs">
        {tabs.map((tab) => (
          <div key={tab.id} className={`flex h-6 min-w-0 items-center rounded px-2 ${tab.id === activeId ? "bg-bg-surface text-text-primary" : "text-text-secondary"}`}>
            <button role="tab" aria-selected={tab.id === activeId} className="min-w-0 truncate" onClick={() => setActiveId(tab.id)}>{tab.label}</button>
            {tabs.length > 1 && <button className="ml-1 shrink-0 rounded p-0.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" aria-label={`Close ${tab.label} tab`} onClick={() => closeTab(tab.id)}><FiX aria-hidden="true" /></button>}
          </div>
        ))}
        {tabs.length > 1 && <button className="ml-1 rounded p-1 text-text-secondary hover:bg-bg-hover hover:text-text-primary" aria-label="New terminal tab" onClick={() => { const tab = newTab(); setTabs((current) => [...current, tab]); setActiveId(tab.id); }}><FiPlus aria-hidden="true" /></button>}
        <button className="ml-auto rounded p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary" aria-label="Copy selection" onClick={copySelection}><FiClipboard aria-hidden="true" /></button>
      </div>
      <div className="relative min-h-0 flex-1">
         {tabs.map((tab) => <TerminalSurface key={`${tab.id}-${tab.restartKey}`} tab={tab} active={tab.id === activeId} fontSize={fontSize} cwd={tab.id === tabs[0].id ? terminalPathRequest ?? undefined : undefined} terminalsRef={terminalsRef} onStateChange={(state, code) => updateTab(tab.id, state, code)} />)}
      </div>
    </div>
  );
}
