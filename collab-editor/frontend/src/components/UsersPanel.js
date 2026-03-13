import { useState, useEffect, useRef } from 'react';

function UsersPanel({ users, currentUserId, onCameraToggle, onMicToggle, onLocalStream, remoteStreams, height }) {
  return (
    <div className="users-panel" style={height ? { height, flexShrink: 0 } : undefined}>
      <div className="panel-header">
        <h3>Active Users</h3>
        <span className="badge">{users.length}</span>
      </div>
      <div className="users-list">
        {users.map(user => (
          <UserCard
            key={user.userId}
            user={user}
            isCurrentUser={user.userId === currentUserId}
            onCameraToggle={onCameraToggle}
            onMicToggle={onMicToggle}
            onLocalStream={onLocalStream}
            remoteStream={remoteStreams?.[user.userId] || null}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, isCurrentUser, onCameraToggle, onMicToggle, onLocalStream, remoteStream }) {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [permError, setPermError] = useState('');
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const streamRef = useRef(null);

  // Sync remote user status
  useEffect(() => {
    if (!isCurrentUser) {
      setCamOn(user.cameraEnabled || false);
      setMicOn(user.micEnabled || false);
    }
  }, [user.cameraEnabled, user.micEnabled, isCurrentUser]);

  // Attach remote stream to video element
  useEffect(() => {
    if (!isCurrentUser && remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream, isCurrentUser]);

  // Only current user can toggle their OWN camera
  const handleCamToggle = async () => {
    setPermError('');
    if (camOn) {
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach(t => t.stop());
        // Keep audio if mic is on
        if (!micOn) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setCamOn(false);
      onCameraToggle && onCameraToggle(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: micOn });
        streamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        setCamOn(true);
        onCameraToggle && onCameraToggle(true);
        onLocalStream && onLocalStream(stream);
      } catch (err) {
        setPermError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera not available.');
      }
    }
  };

  // Only current user can toggle their OWN mic
  const handleMicToggle = async () => {
    setPermError('');
    if (micOn) {
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => t.stop());
      }
      setMicOn(false);
      onMicToggle && onMicToggle(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: camOn });
        streamRef.current = stream;
        setMicOn(true);
        onMicToggle && onMicToggle(true);
        onLocalStream && onLocalStream(stream);
      } catch (err) {
        setPermError(err.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Microphone not available.');
      }
    }
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const initials = user.nickname.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className={`user-card ${isCurrentUser ? 'user-card-self' : ''}`}>
      <div className="user-avatar" style={{ background: user.cursorColor }}>{initials}</div>
      <div className="user-info">
        <span className="user-nickname">
          {user.nickname}
          {isCurrentUser && <span className="you-badge">You</span>}
        </span>
        <span className="user-status" style={{ color: user.cursorColor }}>● Active</span>
      </div>
      {/* Only show controls for the current user's OWN media */}
      <div className="user-controls">
        {isCurrentUser ? (
          <>
            <button className={`icon-btn ${micOn ? 'active' : ''}`} onClick={handleMicToggle} title={micOn ? 'Mute' : 'Unmute'}>
              <MicIcon on={micOn} />
            </button>
            <button className={`icon-btn ${camOn ? 'active' : ''}`} onClick={handleCamToggle} title={camOn ? 'Camera off' : 'Camera on'}>
              <CamIcon on={camOn} />
            </button>
          </>
        ) : (
          <div className="user-media-status">
            {user.micEnabled && <span className="media-indicator" title="Mic on">🎤</span>}
            {user.cameraEnabled && <span className="media-indicator" title="Camera on">📷</span>}
          </div>
        )}
      </div>

      {permError && <div className="media-perm-error">{permError}</div>}

      {/* Local camera preview (muted to prevent echo) */}
      {isCurrentUser && camOn && (
        <div className="video-tile">
          <video ref={localVideoRef} muted autoPlay playsInline className="camera-preview" />
          <span className="video-label">You</span>
        </div>
      )}
      {/* Remote video stream (NOT muted) */}
      {!isCurrentUser && user.cameraEnabled && remoteStream && (
        <div className="video-tile">
          <video ref={remoteVideoRef} autoPlay playsInline className="camera-preview" />
          <span className="video-label">{user.nickname}</span>
        </div>
      )}
      {!isCurrentUser && user.cameraEnabled && !remoteStream && (
        <div className="video-tile remote-video-tile">
          <span className="remote-camera-label">📷 {user.nickname}'s camera</span>
        </div>
      )}
    </div>
  );
}

function MicIcon({ on }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
      {on ? (
        <>
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </>
      ) : (
        <>
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .87-.16 1.71-.46 2.49" />
          <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
        </>
      )}
    </svg>
  );
}

function CamIcon({ on }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
      {on ? (
        <><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></>
      ) : (
        <><path d="M16.5 7.5l6-4v17l-6-4" /><rect x="2" y="5" width="14.5" height="14" rx="2" ry="2" /><line x1="2" y1="2" x2="22" y2="22" /></>
      )}
    </svg>
  );
}

export default UsersPanel;
