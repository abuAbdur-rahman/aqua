import { useCallback, useEffect, useState } from "react";
import { FiFile, FiFolder, FiPlus, FiSave, FiX } from "react-icons/fi";
import { readFile, writeFile } from "../lib/filesystem";
import { editorFileState, languageForFile } from "../lib/editorFiles";
import { useWindowStore } from "../windows/store";

type EditorState = "loading" | "ready" | "error-read" | "binary";
type SaveState = "saved" | "saving" | "error";

type EditorTab = {
  id: string;
  path: string;
  name: string;
  content: string;
  encoding: "utf8" | "base64";
  truncated: boolean;
  state: EditorState;
  error: string | null;
  dirty: boolean;
  saveState: SaveState;
};

type Props = { initialPath?: string };

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function newTab(path = "untitled", id?: string): EditorTab {
  return {
    id: id ?? `${path}-${Date.now()}-${Math.random()}`,
    path,
    name: basename(path),
    content: "",
    encoding: "utf8",
    truncated: false,
    state: path === "untitled" ? "ready" : "loading",
    error: null,
    dirty: false,
    saveState: "saved",
  };
}

function EditorLoading() {
  return <div className="flex h-full flex-col gap-3 bg-bg-surface p-3" aria-label="Loading editor">
    {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-3 animate-pulse rounded bg-bg-hover/40" style={{ width: `${35 + (index % 4) * 14}%` }} />)}
  </div>;
}

export function EditorPane({ initialPath }: Props) {
  const [tabs, setTabs] = useState<EditorTab[]>(() => [newTab(initialPath, "initial")]);
  const [activeId, setActiveId] = useState("initial");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const editorPathRequest = useWindowStore((state) => state.editorPathRequest);
  const clearEditorPathRequest = useWindowStore((state) => state.clearEditorPathRequest);

  const updateTab = useCallback((id: string, update: Partial<EditorTab>) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, ...update } : tab));
  }, []);

  const loadTab = useCallback(async (tab: EditorTab) => {
    if (tab.path === "untitled") return;
    try {
      const response = await readFile(tab.path);
      updateTab(tab.id, {
        content: response.encoding === "utf8" ? response.content : "",
        encoding: response.encoding,
        truncated: response.truncated,
        state: response.encoding === "base64" ? "binary" : "ready",
        error: null,
      });
    } catch (cause: unknown) {
      updateTab(tab.id, { state: "error-read", error: cause instanceof Error ? cause.message : "Unable to read this file" });
    }
  }, [updateTab]);

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeId);
    if (tab?.state === "loading") void loadTab(tab);
  }, [activeId, loadTab, tabs]);

  useEffect(() => {
    if (!editorPathRequest) return;
    const existing = tabs.find((tab) => tab.path === editorPathRequest);
    if (existing) setActiveId(existing.id);
    else {
      const tab = newTab(editorPathRequest);
      setTabs((current) => [...current, tab]);
      setActiveId(tab.id);
    }
    clearEditorPathRequest();
  }, [clearEditorPathRequest, editorPathRequest, tabs]);

  const save = useCallback(async () => {
    if (!active || active.path === "untitled" || active.truncated || active.encoding === "base64" || active.state !== "ready") return;
    updateTab(active.id, { saveState: "saving" });
    try {
      await writeFile(active.path, active.content);
      updateTab(active.id, { dirty: false, saveState: "saved" });
    } catch {
      updateTab(active.id, { saveState: "error" });
    }
  }, [active, updateTab]);

  const beginSave = async () => {
    if (active.path !== "untitled") {
      await save();
      return;
    }
    const path = window.prompt("Save file as", "/home/abdulazeez/untitled.txt");
    if (!path?.trim()) return;
    const trimmed = path.trim();
    updateTab(active.id, { saveState: "saving" });
    try {
      await writeFile(trimmed, active.content);
      updateTab(active.id, { path: trimmed, name: basename(trimmed), dirty: false, saveState: "saved" });
    } catch (cause: unknown) {
      updateTab(active.id, { saveState: "error" });
      window.alert(cause instanceof Error ? cause.message : "Couldn't save file");
    }
  };

  const openFile = () => {
    const path = window.prompt("Open file path");
    if (!path?.trim()) return;
    const existing = tabs.find((tab) => tab.path === path.trim());
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const tab = newTab(path.trim());
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  };

  const closeTab = (id: string) => {
    const tab = tabs.find((item) => item.id === id);
    if (!tab || (tab.dirty && !window.confirm(`Discard unsaved changes in ${tab.name}?`))) return;
    const remaining = tabs.filter((item) => item.id !== id);
    const next = remaining.length ? remaining : [newTab()];
    setTabs(next);
    if (activeId === id) setActiveId(next[0].id);
  };

  const language = languageForFile(active.path);
  const readOnly = (active.path !== "untitled" && editorFileState(active.path) === "uneditable") || active.truncated || active.encoding === "base64" || active.state !== "ready";

  return <div className="flex h-full min-w-0 flex-col bg-bg-surface text-xs">
    <div className="flex h-7 shrink-0 items-center gap-1 overflow-x-auto border-b border-bg-hover bg-bg-elevated px-1" role="tablist" aria-label="Open files">
      {tabs.map((tab) => <div key={tab.id} className={`flex h-6 shrink-0 items-center gap-1 rounded px-2 ${tab.id === activeId ? "bg-bg-surface text-text-primary" : "text-text-secondary hover:bg-bg-hover"}`}>
        <button role="tab" aria-selected={tab.id === activeId} onClick={() => setActiveId(tab.id)} className="flex items-center gap-1.5">
          {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unsaved" />}
          <FiFile aria-hidden="true" />{tab.name}
        </button>
        <button onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.name}`} className="rounded p-0.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"><FiX aria-hidden="true" /></button>
      </div>)}
      <button onClick={() => { const tab = newTab(); setTabs((current) => [...current, tab]); setActiveId(tab.id); }} aria-label="New file" className="rounded p-1.5 text-text-tertiary hover:bg-bg-hover"><FiPlus aria-hidden="true" /></button>
      <div className="ml-auto flex shrink-0 gap-1">
        <button onClick={openFile} aria-label="Open file" className="rounded p-1.5 text-text-tertiary hover:bg-bg-hover"><FiFolder aria-hidden="true" /></button>
         <button onClick={() => void beginSave()} aria-label="Save file" disabled={!active.dirty || readOnly} className="rounded p-1.5 text-text-tertiary hover:bg-bg-hover disabled:opacity-40"><FiSave aria-hidden="true" /></button>
      </div>
    </div>

     {editorFileState(active.path) === "uneditable" && active.path !== "untitled" && <div className="shrink-0 border-b border-status-warning bg-status-warning/10 px-3 py-1.5 text-[11px] text-text-secondary">This file is uneditable. Editing and saving are disabled.</div>}
     {active.truncated && <div className="shrink-0 border-b border-status-warning bg-status-warning/10 px-3 py-1.5 text-[11px] text-text-secondary">This file is large — showing the first portion. Editing and saving are disabled.</div>}
     {active.state === "binary" ? <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"><p className="text-sm text-text-primary">This file can&apos;t be edited here</p><button onClick={openFile} className="text-xs text-accent">Open another file</button></div> : active.state === "error-read" ? <div className="m-3 rounded-card border-l-2 border-status-danger bg-status-danger/10 p-3"><p className="text-xs font-medium text-text-primary">This file no longer exists</p><p className="mt-1 text-[11px] text-text-tertiary">{active.error}</p><div className="mt-2 flex gap-3"><button onClick={() => closeTab(active.id)} className="text-xs text-text-tertiary">Close tab</button><button onClick={() => updateTab(active.id, { state: "ready", error: null })} className="text-xs text-accent">Save as new file</button></div></div> : active.state === "loading" ? <EditorLoading /> : <div className="relative min-h-0 flex-1"><textarea aria-label={`Editor for ${active.name}`} readOnly={readOnly} value={active.content} onChange={(event) => updateTab(active.id, { content: event.target.value, dirty: true, saveState: "saved" })} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void beginSave(); } }} onSelect={(event) => { const value = event.currentTarget.value.slice(0, event.currentTarget.selectionStart); const lines = value.split("\n"); const lastLine = lines[lines.length - 1] ?? ""; setCursor({ line: lines.length, column: lastLine.length + 1 }); }} spellCheck={false} className="h-full w-full resize-none bg-bg-surface p-3 font-mono text-xs leading-5 text-text-primary outline-none selection:bg-accent-bg read-only:cursor-default read-only:opacity-80" /></div>}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-bg-hover bg-bg-elevated px-3 text-[11px] text-text-tertiary"><span className="truncate">{active.name} <span className="mx-1">UTF-8</span> <span className="mx-1">{language}</span> <span className="mx-1">Ln {cursor.line}, Col {cursor.column}</span></span><span className={active.saveState === "error" ? "text-status-danger" : ""}>{active.saveState === "saving" ? "Saving..." : active.saveState === "error" ? "Couldn't save" : "Saved"}</span></div>
   </div>;
}
