/*
  UsersPanel — User list with WebRTC camera/mic, role badges, and admin controls.

  WebRTC FIXES:
  - Mic toggle uses track.enabled instead of track.stop()
  - All video elements: srcObject + autoplay + playsinline + muted (local) + .play().catch()
  - Console.log at every WebRTC lifecycle step
  - Visible error message for getUserMedia denial
*/
import { useState, useEffect, useRef } from 'react';

const ROLE_DISPLAY = {
  admin: { emoji: '👑', label: 'Admin', color: '#FFD700' },
  deputy_admin: { emoji: '⭐', label: 'Deputy Admin', color: '#C0C0C0' },
  editor: { emoji: '✏️', label: 'Editor', color: '#4A90D9' },
  reviewer: { emoji: '🔍', label: 'Reviewer', color: '#9B59B6' },
  viewer: { emoji: '👁️', label: 'Viewer', color: '#808080' },
};

function UsersPanel({
  users, currentUserId, onCameraToggle, onMicToggle, onLocalStream,
  remoteStreams, height, myRole, onChangeRole, onKickUser,
}) {
  const currentUser = users.find(u => u.userId === currentUserId);

  return (
    <div className="users-panel" style={height ? { height, flexShrink: 0 } : undefined}>
      <div className="panel-header">
        <h3>Active Users</h3>
        <span className="badge">{users.length}</span>
      </div>

      {/* Current user role badge */}
      {currentUser && currentUser.role && (
        <div className="my-role-badge" style={{ borderColor: ROLE_DISPLAY[currentUser.role]?.color || '#808080' }}>
          <span>{ROLE_DISPLAY[currentUser.role]?.emoji}</span>
          <span style={{ color: ROLE_DISPLAY[currentUser.role]?.color }}>
            Your Role: {ROLE_DISPLAY[currentUser.role]?.label || currentUser.role}
          </span>
        </div>
      )}

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
            myRole={myRole}
            onChangeRole={onChangeRole}
            onKickUser={onKickUser}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({
  user, isCurrentUser, onCameraToggle, onMicToggle, onLocalStream,
  remoteStream, myRole, onChangeRole, onKickUser,
}) {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [permError, setPermError] = useState('');
  const [showRoleMenu, setShowRoleMenu] = useState(false);
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
      console.log('[WebRTC] Attaching remote stream for', user.nickname);
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.error('[WebRTC] Remote video play error:', e));
    }
  }, [remoteStream, isCurrentUser, user.nickname]);

  // Camera toggle — FIX: use track.enabled, not track.stop() for restart
  const handleCamToggle = async () => {
    setPermError('');
    if (camOn) {
      // Turn off camera: disable track, don't stop() it
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach(t => {
          console.log('[WebRTC] Disabling video track');
          t.enabled = false;
        });
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      setCamOn(false);
      onCameraToggle && onCameraToggle(false);
    } else {
      try {
        console.log('[WebRTC] Requesting getUserMedia for camera...');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('[WebRTC] getUserMedia success, tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}`));
        streamRef.current = stream;

        // If mic was off, disable audio track
        if (!micOn) {
          stream.getAudioTracks().forEach(t => { t.enabled = false; });
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(e => console.error('[WebRTC] Local video play error:', e));
        }
        setCamOn(true);
        onCameraToggle && onCameraToggle(true);
        onLocalStream && onLocalStream(stream);
      } catch (err) {
        console.error('[WebRTC] getUserMedia error:', err);
        if (err.name === 'NotAllowedError') {
          setPermError('Camera/mic permission denied. Please allow access in browser settings.');
        } else {
          setPermError('Camera not available. Check device connections.');
        }
      }
    }
  };

  // Mic toggle — FIX: use track.enabled = true/false, NOT track.stop()
  const handleMicToggle = async () => {
    setPermError('');
    if (micOn) {
      // Turn off mic: just disable the track, don't stop it
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => {
          console.log('[WebRTC] Disabling audio track (mute)');
          t.enabled = false;
        });
      }
      setMicOn(false);
      onMicToggle && onMicToggle(false);
    } else {
      // Turn on mic: if we already have a stream, just enable audio track
      if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
        streamRef.current.getAudioTracks().forEach(t => {
          console.log('[WebRTC] Enabling audio track (unmute)');
          t.enabled = true;
        });
        setMicOn(true);
        onMicToggle && onMicToggle(true);
      } else {
        // Need to get new stream with audio
        try {
          console.log('[WebRTC] Requesting getUserMedia for mic...');
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: camOn });
          console.log('[WebRTC] getUserMedia (mic) success');
          streamRef.current = stream;

          // If camera was off, disable video track
          if (!camOn) {
            stream.getVideoTracks().forEach(t => { t.enabled = false; });
          }

          setMicOn(true);
          onMicToggle && onMicToggle(true);
          onLocalStream && onLocalStream(stream);
        } catch (err) {
          console.error('[WebRTC] getUserMedia (mic) error:', err);
          if (err.name === 'NotAllowedError') {
            setPermError('Camera/mic permission denied. Please allow access in browser settings.');
          } else {
            setPermError('Microphone not available.');
          }
        }
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
  const roleInfo = ROLE_DISPLAY[user.role] || ROLE_DISPLAY.viewer;

  return (
    <div className={`user-card ${isCurrentUser ? 'user-card-self' : ''}`}>
      <div className="user-avatar" style={{ background: user.cursorColor }}>{initials}</div>
      <div className="user-info">
        <span className="user-nickname">
          {user.nickname}
          {isCurrentUser && <span className="you-badge">You</span>}
        </span>
        <span className="user-role-badge" style={{ color: roleInfo.color }}>
          {roleInfo.emoji} {roleInfo.label}
        </span>
      </div>

      {/* Media controls */}
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

        {/* Admin controls: role change and kick */}
        {!isCurrentUser && myRole === 'admin' && (
          <div className="admin-controls">
            <button
              className="icon-btn"
              title="Change role"
              onClick={() => setShowRoleMenu(!showRoleMenu)}
            >
              ⚙️
            </button>
            <button
              className="icon-btn kick-btn"
              title="Kick user"
              onClick={() => onKickUser && onKickUser(user.dbUserId)}
            >
              ❌
            </button>

            {showRoleMenu && (
              <div className="role-dropdown">
                {['deputy_admin', 'editor', 'reviewer', 'viewer'].map(r => (
                  <button
                    key={r}
                    className={`role-option ${user.role === r ? 'active' : ''}`}
                    onClick={() => {
                      onChangeRole && onChangeRole(user.dbUserId, r);
                      setShowRoleMenu(false);
                    }}
                  >
                    {ROLE_DISPLAY[r].emoji} {ROLE_DISPLAY[r].label}
                  </button>
                ))}
              </div>
            )}
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
