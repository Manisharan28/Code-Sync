import { useState } from 'react';

function UsersPanel({ users, currentUserId }) {
  return (
    <div className="users-panel">
      <div className="panel-header">
        <h3>Active Users</h3>
        <span className="badge">{users.length}</span>
      </div>
      <div className="users-list">
        {users.map((user) => (
          <UserCard
            key={user.userId}
            user={user}
            isCurrentUser={user.userId === currentUserId}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, isCurrentUser }) {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);

  const initials = user.nickname
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={`user-card ${isCurrentUser ? 'user-card-self' : ''}`}>
      <div className="user-avatar" style={{ background: user.cursorColor }}>
        {initials}
      </div>
      <div className="user-info">
        <span className="user-nickname">
          {user.nickname}
          {isCurrentUser && <span className="you-badge">You</span>}
        </span>
        <span className="user-status" style={{ color: user.cursorColor }}>● Active</span>
      </div>
      <div className="user-controls">
        <button
          className={`icon-btn ${micOn ? 'active' : ''}`}
          onClick={() => setMicOn(!micOn)}
          title={micOn ? 'Mute' : 'Unmute'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
            {micOn ? (
              <>
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </>
            ) : (
              <>
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .87-.16 1.71-.46 2.49" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </>
            )}
          </svg>
        </button>
        <button
          className={`icon-btn ${camOn ? 'active' : ''}`}
          onClick={() => setCamOn(!camOn)}
          title={camOn ? 'Camera off' : 'Camera on'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
            {camOn ? (
              <>
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </>
            ) : (
              <>
                <path d="M16.5 7.5l6-4v17l-6-4" />
                <rect x="2" y="5" width="14.5" height="14" rx="2" ry="2" />
                <line x1="2" y1="2" x2="22" y2="22" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* WebRTC-ready video tile placeholder */}
      {camOn && (
        <div className="video-tile">
          <span>📷 Camera preview</span>
        </div>
      )}
    </div>
  );
}

export default UsersPanel;
