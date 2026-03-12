import { useEffect, useRef } from 'react';

function TerminalPanel({ output }) {
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [output]);

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        <span className="terminal-title">Terminal</span>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        <pre>{output || '$ Ready to run...'}</pre>
      </div>
    </div>
  );
}

export default TerminalPanel;
