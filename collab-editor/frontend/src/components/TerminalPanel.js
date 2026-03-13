/*
  TerminalPanel — Interactive terminal with stdin support.
  - Removed red/yellow/green dots (#6)
  - Input field sends terminal_input for stdin to running process (#4)
  - onRunCommand executes code, onTerminalInput sends stdin
*/
import { useEffect, useRef, useState } from 'react';

function TerminalPanel({ lines, isRunning, onRunCommand, onTerminalInput, onClear, height }) {
  const bodyRef = useRef(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input;
    if (!text) return;
    setInput('');
    if (isRunning) {
      // Send stdin to the running process
      onTerminalInput && onTerminalInput(text);
    } else {
      // Execute a new command
      onRunCommand && onRunCommand(text);
    }
  };

  return (
    <div className="terminal-panel" style={height ? { height, flexShrink: 0 } : undefined}>
      <div className="terminal-header">
        <span className="terminal-title">Terminal</span>
        <button className="terminal-clear-btn" onClick={onClear} title="Clear terminal">✕ Clear</button>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {lines.length === 0 && !isRunning && (
          <pre className="terminal-placeholder">$ Ready. Type code below or press Run Code.</pre>
        )}
        {lines.map((item, i) => (
          <pre key={i} className={`terminal-line terminal-${item.type}`}>
            {item.type === 'input' ? <><span className="terminal-prompt">$ </span>{item.text}</> : item.text}
          </pre>
        ))}
        {isRunning && <pre className="terminal-running">Running<span className="ellipsis-anim">...</span></pre>}
      </div>
      <form className="terminal-input-form" onSubmit={handleSubmit}>
        <span className="terminal-prompt-label">{isRunning ? '›' : '$'}</span>
        <input
          type="text"
          className="terminal-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isRunning ? 'Type input and press Enter...' : 'Type code to run...'}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="terminal-run-btn" disabled={!input} title={isRunning ? 'Send input' : 'Run'}>
          {isRunning ? (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          )}
        </button>
      </form>
    </div>
  );
}

export default TerminalPanel;
