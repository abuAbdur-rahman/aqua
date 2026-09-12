import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/language/json/json.worker?worker";
import cssWorker from "monaco-editor/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/language/html/html.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import Editor, { type OnMount } from "@monaco-editor/react";

// Offline worker wiring: bundle the language workers locally instead of
// pulling them from a CDN (the app runs in a frameless Tauri WebView with no
// external network). The default Monaco loader would fetch from jsdelivr.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Point @monaco-editor/react at the locally bundled monaco instance.
loader.config({ monaco });

export interface MonacoEditorProps {
  value: string;
  language: string;
  path: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onCursor?: (line: number, column: number) => void;
  onSave?: () => void;
}

export default function MonacoEditor({
  value,
  language,
  path,
  readOnly,
  onChange,
  onCursor,
  onSave,
}: MonacoEditorProps) {
  const handleMount: OnMount = (editor) => {
    if (onCursor) {
      editor.onDidChangeCursorPosition((e) => onCursor(e.position.lineNumber, e.position.column));
    }
    if (onSave) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSave());
    }
  };

  return (
    <Editor
      height="100%"
      width="100%"
      theme="vs-dark"
      path={path}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      onMount={handleMount}
      options={{
        readOnly,
        fontSize: 13,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: "off",
        renderWhitespace: "selection",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        padding: { top: 8, bottom: 8 },
      }}
    />
  );
}
