/*
  TerminalPanel — Inline terminal input.
  - No separate input bar
  - Click the terminal body and type directly, like a real shell
  - Enter sends the typed line as stdin (if running) or runs as code (if idle)
  - Backspace removes last character
  - Blinking cursor shown at end of input line
*/
import { useEffect, useRef, useState } from 'react';

function TerminalPanel({ lines, isRunning, onRunCommand, onTerminalInput, onClear, height }) {
  const bodyRef = useRef(null);
  const [inputBuffer, setInputBuffer] = useState('');
  const [focused, setFocused] = useState(false);

  // Auto-scroll to bottom whenever lines or inputBuffer change
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, inputBuffer]);

  // Focus the terminal body on mount
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = inputBuffer;
      setInputBuffer('');
      if (isRunning) {
        onTerminalInput && onTerminalInput(text);
      } else {
        if (text.trim()) onRunCommand && onRunCommand(text);
      }
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      setInputBuffer(prev => prev.slice(0, -1));
    } else if (e.ctrlKey && e.key === 'c') {
      // Ctrl+C — send interrupt signal to running process
      e.preventDefault();
      setInputBuffer('');
      onTerminalInput && onTerminalInput('\x03');
    } else if (e.ctrlKey) {
      // Block other Ctrl combos to prevent browser shortcuts from firing
      // while the terminal has focus (e.g. Ctrl+W closes tab)
      if (['w', 't', 'r', 'n', 'l'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
      // Don't capture Ctrl+A/C/V/X (copy/paste/select-all) — let them through
    } else if (e.key.length === 1) {
      // Printable character
      e.preventDefault();
      setInputBuffer(prev => prev + e.key);
    }
  };

  return (
    <div className="terminal-panel" style={height ? { height, flexShrink: 0 } : undefined}>
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <span className="terminal-hint">Click terminal &amp; type to input</span>
        <button className="terminal-clear-btn" onClick={onClear} title="Clear terminal">✕ Clear</button>
      </div>
      <div
        className={`terminal-body${focused ? ' terminal-body-focused' : ''}`}
        ref={bodyRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => bodyRef.current && bodyRef.current.focus()}
      >
        {lines.length === 0 && !isRunning && (
          <pre className="terminal-placeholder">$ Click here and type code, then press Enter to run.</pre>
        )}
        {lines.map((item, i) => (
          <pre key={i} className={`terminal-line terminal-${item.type}`}>
            {item.type === 'input' ? <><span className="terminal-prompt">$ </span>{item.text}</> : item.text}
          </pre>
        ))}
        {isRunning && <pre className="terminal-running">Running<span className="ellipsis-anim">...</span></pre>}

        {/* Inline input line — always visible */}
        <pre className="terminal-line terminal-input-inline">
          <span className="terminal-prompt">{isRunning ? '› ' : '$ '}</span>
          {inputBuffer}
          <span className={`terminal-cursor${focused ? ' terminal-cursor-blink' : ''}`}>▌</span>
        </pre>
      </div>
    </div>
  );
}

export default TerminalPanel;
