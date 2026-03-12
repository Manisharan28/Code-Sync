import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import LanguageSelector from './LanguageSelector';

const LANG_MAP = { python: 'python', javascript: 'javascript', cpp: 'cpp', java: 'java' };

function EditorPanel({
  code, language, remoteCursors, onCodeChange,
  onCursorMove, onLanguageChange, onRun, isRunning,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decoIdsRef = useRef([]);

  /* ---------- remote cursor decorations ---------- */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const decos = remoteCursors.map((c) => ({
      range: new monaco.Range(c.line || 1, c.column || 1, c.line || 1, c.column || 1),
      options: {
        className: 'remote-cursor-line',
        beforeContentClassName: 'remote-cursor-widget',
        after: {
          content: ` ${c.nickname || c.userId}`,
          inlineClassName: 'remote-cursor-tag',
        },
        stickiness: 1,
      },
    }));

    decoIdsRef.current = editor.deltaDecorations(decoIdsRef.current, decos);
  }, [remoteCursors]);

  /* inject per-cursor color CSS */
  useEffect(() => {
    const id = 'remote-cursor-dynamic-css';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }

    el.textContent = remoteCursors.map((c, i) => `
      .monaco-editor .remote-cursor-deco-${i} { border-left: 2px solid ${c.cursorColor}; }
    `).join('');
  }, [remoteCursors]);

  const handleMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition((e) => onCursorMove(e.position));
  };

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <LanguageSelector value={language} onChange={onLanguageChange} />
        <button className="btn btn-run" onClick={onRun} disabled={isRunning}>
          {isRunning ? (
            <><span className="spinner" /> Running…</>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run Code
            </>
          )}
        </button>
      </div>

      <div className="editor-container">
        <Editor
          value={code}
          language={LANG_MAP[language] || 'python'}
          theme="vs-dark"
          onChange={onCodeChange}
          onMount={handleMount}
          options={{
            fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
            fontSize: 14,
            lineHeight: 22,
            minimap: { enabled: false },
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            renderLineHighlight: 'gutter',
            bracketPairColorization: { enabled: true },
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

export default EditorPanel;
