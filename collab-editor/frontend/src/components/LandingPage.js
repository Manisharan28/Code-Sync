import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { BACKEND_URL } from '../socket';

const MAX_RECENT = 5;

function getRecentRooms() {
  try {
    const stored = localStorage.getItem('codesync_recent_rooms');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function addRecentRoom(roomId) {
  let rooms = getRecentRooms();
  rooms = rooms.filter(id => id !== roomId);
  rooms.unshift(roomId);
  localStorage.setItem('codesync_recent_rooms', JSON.stringify(rooms.slice(0, MAX_RECENT)));
}

function LandingPage({ currentUser, onLogout }) {
  const navigate = useNavigate();
  const [roomToJoin, setRoomToJoin] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentRooms, setRecentRooms] = useState([]);

  useEffect(() => {
    setRecentRooms(getRecentRooms());
  }, []);

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const roomId = uuidv4().slice(0, 8); // Generate a UUID for the room ID
      const res = await fetch(`${BACKEND_URL}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ roomId, password: createPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create room. Try again.');
        setLoading(false);
        return;
      }

      const data = await res.json();
      sessionStorage.setItem(`codesync_password_${data.roomId}`, createPassword);
      addRecentRoom(data.roomId);
      navigate(`/room/${data.roomId}`);
    } catch (err) {
      console.error(err);
      setError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e, overrideId) => {
    if (e) e.preventDefault();
    const id = (overrideId || roomToJoin).trim();
    if (!id) { setError('Please enter a room ID.'); return; }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${BACKEND_URL}/rooms/${id}/exists`, { credentials: 'include' });
      const data = await res.json();
      if (!data.exists) {
        setError('Room does not exist. Please check the ID or create a new room.');
        setLoading(false);
        return;
      }

      if (data.hasPassword) {
        const pvRes = await fetch(`${BACKEND_URL}/rooms/${id}/validate_password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ password: joinPassword }),
        });
        const pvData = await pvRes.json();
        if (!pvData.valid) {
          setError(pvData.error || 'Incorrect password.');
          setLoading(false);
          return;
        }
      }

      sessionStorage.setItem(`codesync_password_${id}`, joinPassword);
      addRecentRoom(id);
      navigate(`/room/${id}`);
    } catch (err) {
      console.error(err);
      setError('Network error. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const handleRecentRoom = (id) => {
    setRoomToJoin(id);
    handleJoinRoom(null, id);
  };

  const username = currentUser?.username || 'Guest';
  const initial = username.charAt(0).toUpperCase();
  const avatarColor = currentUser?.avatar_color || '#4A90D9';

  return (
    <div className="landing-page">
      <div className="landing-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28" style={{ color: 'var(--blue)' }}>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
            <line x1="14" y1="4" x2="10" y2="20" />
          </svg>
          <h1 className="landing-title">CodeSync</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="user-avatar" style={{ background: avatarColor, width: '32px', height: '32px', fontSize: '14px' }}>
            {initial}
          </div>
          <span style={{ fontWeight: 500 }}>{username}</span>
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="landing-content">
        <div className="landing-glow" />

        <p className="landing-quote">"Code together. Debug faster. Build smarter."</p>

        {error && <div className="landing-error">{error}</div>}

        <div className="landing-actions" style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <form className="landing-form" onSubmit={handleCreateRoom} style={{ flex: 1, minWidth: '280px', maxWidth: '350px' }}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create New Room
            </button>
            <input
              type="password"
              value={createPassword}
              onChange={e => setCreatePassword(e.target.value)}
              placeholder="Room password (optional)"
              className="input-field"
              style={{ marginTop: '0.5rem' }}
            />
          </form>

          <form className="landing-form" onSubmit={handleJoinRoom} style={{ flex: 1, minWidth: '280px', maxWidth: '350px' }}>
            <input
              type="text"
              value={roomToJoin}
              onChange={e => setRoomToJoin(e.target.value.replace(/\s/g, ''))}
              placeholder="Enter Room ID"
              className="input-field"
            />
            <input
              type="password"
              value={joinPassword}
              onChange={e => setJoinPassword(e.target.value)}
              placeholder="Room password (if any)"
              className="input-field"
              style={{ marginTop: '0.5rem' }}
            />
            <button type="submit" className="btn btn-secondary btn-lg" disabled={loading || !roomToJoin.trim()} style={{ width: '100%', marginTop: '0.5rem' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Join Room
            </button>
          </form>
        </div>

        {recentRooms.length > 0 && (
          <div className="recent-rooms">
            <h3 className="recent-title">Recent Rooms</h3>
            <div className="recent-list">
              {recentRooms.map(id => (
                <button
                  key={id}
                  className="recent-room-btn"
                  onClick={() => handleRecentRoom(id)}
                  title="Join recent room"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default LandingPage;
