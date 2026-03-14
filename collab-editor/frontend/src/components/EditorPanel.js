/*
  EditorPanel — Monaco editor with multi-file support, cursor tracking,
  proper language icons (#5), and extension-stripped active file badge (#7).
*/
import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import LanguageSelector from './LanguageSelector';

const LANG_MAP = {
  python: 'python', javascript: 'javascript', cpp: 'cpp', java: 'java',
  ts: 'typescript', html: 'html', css: 'css', json: 'json',
};

function inferLanguage(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  const map = {
    py: 'python', js: 'javascript', ts: 'typescript', jsx: 'javascript',
    tsx: 'typescript', cpp: 'cpp', cc: 'cpp', java: 'java',
    html: 'html', css: 'css', json: 'json', md: 'markdown',
  };
  return map[ext] || 'plaintext';
}

/* Strip extension for display (#7) */
function displayName(filename) {
  const idx = (filename || '').lastIndexOf('.');
  return idx > 0 ? filename.substring(0, idx) : filename;
}

function EditorPanel({
  code, language, activeFile, remoteCursors, onCodeChange,
  onCursorMove, onLanguageChange, onRun, isRunning, readOnly,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decoIdsRef = useRef([]);

  const editorLanguage = inferLanguage(activeFile) !== 'plaintext'
    ? inferLanguage(activeFile)
    : (LANG_MAP[language] || 'python');

  /* Remote cursor decorations */
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const decos = remoteCursors.map(c => ({
      range: new monaco.Range(c.line || 1, c.column || 1, c.line || 1, (c.column || 1) + 1),
      options: {
        className: `remote-cursor-line-${c.userId?.replace(/[^a-z0-9]/gi, '')}`,
        after: {
          content: ` ${c.nickname || c.userId}`,
          inlineClassName: `remote-cursor-tag remote-cursor-tag-${c.userId?.replace(/[^a-z0-9]/gi, '')}`,
        },
        stickiness: 1,
      },
    }));
    decoIdsRef.current = editor.deltaDecorations(decoIdsRef.current, decos);
  }, [remoteCursors]);

  /* Inject per-cursor color CSS */
  useEffect(() => {
    const id = 'remote-cursor-dynamic-css';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = remoteCursors.map(c => {
      const safeId = c.userId?.replace(/[^a-z0-9]/gi, '') || 'unknown';
      const color = c.cursorColor || '#89b4fa';
      return `.monaco-editor .remote-cursor-line-${safeId}{border-left:2px solid ${color}} .monaco-editor .remote-cursor-tag-${safeId}{background:${color}28;color:${color};padding:1px 5px;border-radius:3px;font-size:11px;margin-left:4px}`;
    }).join('');
  }, [remoteCursors]);

  const handleMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition(e => onCursorMove(e.position));
  };

  return (
    <div className="editor-panel">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          {activeFile && <span className="active-file-badge">{displayName(activeFile)}</span>}
          <LanguageSelector value={language} onChange={onLanguageChange} />
        </div>
        <button className="btn btn-run" onClick={onRun} disabled={isRunning}>
          {isRunning ? (
            <><span className="spinner" /> Running…</>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              Run Code
            </>
          )}
        </button>
      </div>
      <div className="editor-container">
        <Editor
          value={code}
          language={editorLanguage}
          theme="vs-dark"
          onChange={onCodeChange}
          onMount={handleMount}
          options={{
            readOnly: readOnly,
            fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
            fontSize: 14, lineHeight: 22,
            minimap: { enabled: false },
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false, smoothScrolling: true,
            cursorBlinking: 'smooth', cursorSmoothCaretAnimation: 'on',
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
