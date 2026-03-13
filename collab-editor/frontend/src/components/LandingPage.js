import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../socket';

const MAX_RECENT = 5;

function getRecentRooms() {
  try {
    return JSON.parse(localStorage.getItem('codesync_recent_rooms') || '[]');
  } catch { return []; }
}

function addRecentRoom(roomId) {
  const rooms = getRecentRooms().filter(r => r !== roomId);
  rooms.unshift(roomId);
  localStorage.setItem('codesync_recent_rooms', JSON.stringify(rooms.slice(0, MAX_RECENT)));
}

function LandingPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [joinId, setJoinId] = useState('');
  const [customId, setCustomId] = useState('');
  const [useCustomId, setUseCustomId] = useState(false);
  const [password, setPassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentRooms, setRecentRooms] = useState([]);

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const generateRoomId = () => Math.random().toString(36).slice(2, 8);

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    if (!nickname.trim()) { setError('Please enter a nickname.'); return; }
    setLoading(true);
    setError('');

    const roomId = useCustomId ? customId.trim() : generateRoomId();
    if (!roomId) { setError('Please enter a room ID.'); setLoading(false); return; }

    try {
      const res = await fetch(`${BACKEND_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, password }),
      });

      if (res.status === 409) {
        setError('Room ID already taken. Try a different one.');
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError('Failed to create room. Try again.');
        setLoading(false);
        return;
      }

      const data = await res.json();
      sessionStorage.setItem('codesync_nickname', nickname.trim());
      sessionStorage.setItem(`codesync_password_${data.roomId}`, password);
      addRecentRoom(data.roomId);
      navigate(`/room/${data.roomId}`);
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e, overrideId) => {
    if (e) e.preventDefault();
    const id = (overrideId || joinId).trim();
    if (!id) { setError('Please enter a room ID.'); return; }
    if (!nickname.trim()) { setError('Please enter a nickname.'); return; }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND_URL}/rooms/${id}/exists`);
      const data = await res.json();
      if (!data.exists) {
        setError('Room does not exist. Please check the ID or create a new room.');
        setLoading(false);
        return;
      }

      if (data.hasPassword && !showJoinPassword) {
        setShowJoinPassword(true);
        setLoading(false);
        return;
      }

      if (data.hasPassword && joinPassword) {
        const pvRes = await fetch(`${BACKEND_URL}/rooms/${id}/validate_password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: joinPassword }),
        });
        const pvData = await pvRes.json();
        if (!pvData.valid) {
          setError('Incorrect room password.');
          setLoading(false);
          return;
        }
      }

      sessionStorage.setItem('codesync_nickname', nickname.trim());
      sessionStorage.setItem(`codesync_password_${id}`, joinPassword);
      addRecentRoom(id);
      navigate(`/room/${id}`);
    } catch {
      setError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const handleRecentRoom = (id) => {
    if (!nickname.trim()) {
      setJoinId(id);
      setMode('join');
      return;
    }
    handleJoinRoom(null, id);
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

        {/* Nickname field always visible */}
        <div className="landing-nickname-row">
          <input
            type="text"
            value={nickname}
            onChange={e => setNickname(e.target.value)}
            placeholder="Your nickname (e.g. DevMaster42)"
            className="input-field"
            maxLength={20}
          />
        </div>

        {error && <div className="landing-error">{error}</div>}

        {!mode && (
          <div className="landing-actions">
            <button className="btn btn-primary btn-lg" onClick={() => { setMode('create'); setError(''); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create Room
            </button>
            <button className="btn btn-secondary btn-lg" onClick={() => { setMode('join'); setError(''); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Join Room
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form className="landing-form" onSubmit={handleCreateRoom}>
            <div className="form-toggle-row">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={useCustomId}
                  onChange={e => setUseCustomId(e.target.checked)}
                />
                <span>Custom Room ID</span>
              </label>
            </div>
            {useCustomId && (
              <input
                type="text"
                value={customId}
                onChange={e => setCustomId(e.target.value.replace(/\s/g, ''))}
                placeholder="my-project-room"
                className="input-field"
                maxLength={30}
              />
            )}
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Room password (optional)"
              className="input-field"
            />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMode(null); setError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading || !nickname.trim()}>
                {loading ? 'Creating…' : 'Create & Enter'}
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form className="landing-form" onSubmit={handleJoinRoom}>
            <input
              type="text"
              value={joinId}
              onChange={e => setJoinId(e.target.value.replace(/\s/g, ''))}
              placeholder="Enter Room ID"
              className="input-field"
              autoFocus
            />
            {showJoinPassword && (
              <input
                type="password"
                value={joinPassword}
                onChange={e => setJoinPassword(e.target.value)}
                placeholder="Room password"
                className="input-field"
                autoFocus
              />
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setMode(null); setShowJoinPassword(false); setError(''); }}>Cancel</button>
              <button type="submit" className="btn btn-secondary" disabled={loading || !joinId.trim() || !nickname.trim()}>
                {loading ? 'Joining…' : showJoinPassword ? 'Confirm Password' : 'Join'}
              </button>
            </div>
          </form>
        )}

        {recentRooms.length > 0 && (
          <div className="recent-rooms">
            <div className="recent-rooms-title">Recent Rooms</div>
            <div className="recent-rooms-list">
              {recentRooms.map(id => (
                <button
                  key={id}
                  className="recent-room-btn"
                  onClick={() => handleRecentRoom(id)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="landing-features">
          <div className="feature-card"><span className="feature-icon">⚡</span><span>Real-time sync</span></div>
          <div className="feature-card"><span className="feature-icon">👥</span><span>Live cursors</span></div>
          <div className="feature-card"><span className="feature-icon">▶</span><span>Run code</span></div>
          <div className="feature-card"><span className="feature-icon">💬</span><span>Team chat</span></div>
        </div>
      </div>

      <footer className="landing-footer">
        CodeSync &copy; 2026 — Real-time collaborative coding platform
      </footer>
    </div>
  );
}

export default LandingPage;
