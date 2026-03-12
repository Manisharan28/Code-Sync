import { useState } from 'react';

function LandingPage({ onCreateRoom, onJoinRoom }) {
  const [joinId, setJoinId] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  const handleJoinSubmit = (e) => {
    e.preventDefault();
    if (joinId.trim()) onJoinRoom(joinId.trim());
  };

  return (
    <div className="landing-page">
      <div className="landing-content">
        <div className="landing-glow" />

        <div className="landing-logo">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
            <line x1="14" y1="4" x2="10" y2="20" />
          </svg>
          <h1 className="landing-title">CodeSync</h1>
        </div>

        <p className="landing-quote">"Code together. Debug faster. Build smarter."</p>

        <div className="landing-actions">
          <button className="btn btn-primary btn-lg" onClick={onCreateRoom}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Room
          </button>

          {!showJoinInput ? (
            <button className="btn btn-secondary btn-lg" onClick={() => setShowJoinInput(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Join Room
            </button>
          ) : (
            <form className="join-form" onSubmit={handleJoinSubmit}>
              <input
                type="text"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="Enter Room ID"
                className="input-field"
                autoFocus
              />
              <button type="submit" className="btn btn-secondary" disabled={!joinId.trim()}>
                Join
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowJoinInput(false)}>
                Cancel
              </button>
            </form>
          )}
        </div>

        <div className="landing-features">
          <div className="feature-card">
            <span className="feature-icon">⚡</span>
            <span>Real-time sync</span>
          </div>
          <div className="feature-card">
            <span className="feature-icon">👥</span>
            <span>Live cursors</span>
          </div>
          <div className="feature-card">
            <span className="feature-icon">▶</span>
            <span>Run code</span>
          </div>
          <div className="feature-card">
            <span className="feature-icon">💬</span>
            <span>Team chat</span>
          </div>
        </div>
      </div>

      <footer className="landing-footer">
        CodeSync &copy; 2026 — Real-time collaborative coding platform
      </footer>
    </div>
  );
}

export default LandingPage;
