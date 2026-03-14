/*
  RoomPage — Main room view with WebRTC, terminal I/O, resizable panels, files,
  and role-based access control (Admin/Deputy Admin/Editor/Reviewer/Viewer).
*/
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import EditorPanel from './EditorPanel';
import TerminalPanel from './TerminalPanel';
import UsersPanel from './UsersPanel';
import ChatPanel from './ChatPanel';
import FilesSidebar from './FilesSidebar';

/* ---------- clipboard fallback ---------- */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try { document.execCommand('copy'); return Promise.resolve(); }
  catch (err) { return Promise.reject(err); }
  finally { document.body.removeChild(ta); }
}

const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2)}`;
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Role permission helpers for frontend UI state
const canWrite = (role) => ['admin', 'deputy_admin', 'editor'].includes(role);
const canApprove = (role) => ['admin', 'deputy_admin', 'reviewer'].includes(role);

function RoomPage({ userId, currentUser, onLogout }) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  // We rely on the logged-in user context
  const nickname = currentUser?.username || 'Anonymous';
  const dbUserId = currentUser?.id;
  const roomPassword = sessionStorage.getItem(`codesync_password_${roomId}`) || '';

  /* ---- state ---- */
  const [files, setFiles] = useState({ 'main.py': '# Start coding here\n' });
  const [activeFile, setActiveFile] = useState('main.py');
  const [language, setLanguage] = useState('python');
  const [terminalLines, setTerminalLines] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [users, setUsers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [cursorColor, setCursorColor] = useState('#89b4fa');
  const [connected, setConnected] = useState(socket.connected);
  const [joinError, setJoinError] = useState('');
  const [joinPending, setJoinPending] = useState(''); // waiting for approval message
  const [displayNickname, setDisplayNickname] = useState(nickname);
  const [myRole, setMyRole] = useState('viewer'); // default role

  // Join approval state (for admins)
  const [pendingRequests, setPendingRequests] = useState([]);

  /* ---- refs ---- */
  const lastRemoteCodeRef = useRef(null);
  const notifIdRef = useRef(0);
  const hasJoinedRef = useRef(false);
  const peerConnectionsRef = useRef({});  // sid → RTCPeerConnection
  const localStreamRef = useRef(null);
  const remoteStreamsRef = useRef({});    // userId → MediaStream
  const sidToUserIdRef = useRef({});      // socketSid → userId
  const [remoteStreams, setRemoteStreams] = useState({});

  /* ---- panel sizes ---- */
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [usersPanelHeight, setUsersPanelHeight] = useState(250);

  /* ---- toast notifications ---- */
  const addNotification = useCallback((text) => {
    const id = ++notifIdRef.current;
    setNotifications(prev => [...prev, { id, text }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 5000);
  }, []);

  /* ========== WebRTC helpers ========== */
  const createPeerConnection = useCallback((remoteSid) => {
    if (peerConnectionsRef.current[remoteSid]) return peerConnectionsRef.current[remoteSid];
    console.log('[WebRTC] Creating RTCPeerConnection for', remoteSid);
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice', { targetSid: remoteSid, candidate: e.candidate });
      }
    };

    // FIX: Verify streams array
    pc.ontrack = (e) => {
      console.log('[WebRTC] ontrack fired from', remoteSid);
      if (e.streams && e.streams[0]) {
        const stream = e.streams[0];
        const remoteUserId = sidToUserIdRef.current[remoteSid] || remoteSid;
        console.log('[WebRTC] Adding remote stream for userId:', remoteUserId);
        remoteStreamsRef.current[remoteUserId] = stream;
        setRemoteStreams(prev => ({ ...prev, [remoteUserId]: stream }));
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        console.log('[WebRTC] Creating offer for', remoteSid);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', {
          targetSid: remoteSid,
          offer: pc.localDescription,
          fromUserId: userId,
          fromNickname: displayNickname,
        });
      } catch (err) {
        console.error('[WebRTC] Negotiation error:', err);
      }
    };

    // FIX: Add tracks BEFORE creating offer
    if (localStreamRef.current) {
      console.log('[WebRTC] Adding local tracks to PC for', remoteSid);
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    peerConnectionsRef.current[remoteSid] = pc;
    return pc;
  }, [userId, displayNickname]);

  const cleanupPeerConnection = useCallback((remoteSid) => {
    const pc = peerConnectionsRef.current[remoteSid];
    if (pc) {
      console.log('[WebRTC] Closing PC for', remoteSid);
      pc.close();
      delete peerConnectionsRef.current[remoteSid];
    }
    const remoteUserId = sidToUserIdRef.current[remoteSid] || remoteSid;
    delete sidToUserIdRef.current[remoteSid];
    delete remoteStreamsRef.current[remoteUserId];
    setRemoteStreams(prev => {
      const next = { ...prev };
      delete next[remoteUserId];
      return next;
    });
  }, []);

  /* ========== Socket wiring ========== */
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      if (!hasJoinedRef.current) {
        hasJoinedRef.current = true;
        socket.emit('join_room', {
          room: roomId, nickname, userId, sessionId: SESSION_ID,
          create: false, password: roomPassword,
        });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      hasJoinedRef.current = false;
    };

    const handleRoomJoined = (data) => {
      setJoinPending('');
      setJoinError('');
      setFiles(data.files || { 'main.py': '' });
      setActiveFile(data.activeFile || 'main.py');
      setLanguage(data.language || 'python');
      setUsers(data.users || []);
      setChatMessages(data.chat || []);
      setCursorColor(data.cursorColor || '#89b4fa');
      if (data.nickname) setDisplayNickname(data.nickname);
      if (data.role) setMyRole(data.role);
    };

    const handleJoinError = (data) => {
      setJoinError(data.message || 'Could not join room.');
    };

    const handleJoinPending = (data) => {
      setJoinPending(data.message || 'Waiting for admin approval...');
    };

    // --- Admin role approvals ---
    const handlePendingJoinRequest = (data) => {
      setPendingRequests(prev => [...prev, data]);
      addNotification(`${data.username} wants to join the room.`);
    };

    const handleJoinApproved = (data) => {
      if (data.dbUserId === dbUserId) {
        // We were approved! Rejoin to get room state
        hasJoinedRef.current = false;
        handleConnect();
      } else {
        addNotification(`${data.username} was approved to join.`);
      }
    };

    const handleJoinRejected = (data) => {
      if (data.dbUserId === dbUserId) {
        setJoinPending('');
        setJoinError('Your request to join was rejected by the admin.');
      }
    };

    const handleRoleChanged = (data) => {
      setUsers(data.users || []);
      if (data.dbUserId === dbUserId) {
        setMyRole(data.newRole);
        addNotification(`Your role was changed to ${data.newRole}`);
      }
    };

    const handleUserKicked = (data) => {
      addNotification('You were kicked from the room.');
      navigate('/');
    };

    // --- Standard room events ---
    const handleCodeUpdate = (data) => {
      const filename = data.filename || activeFile;
      lastRemoteCodeRef.current = `${filename}::${data.code}`;
      setFiles(prev => ({ ...prev, [filename]: data.code || '' }));
    };

    const handleCursorUpdate = (data) => {
      if (data.userId === userId) return;
      setRemoteCursors(prev => ({ ...prev, [data.userId]: data }));
    };

    const handleUserJoined = (data) => {
      setUsers(data.users || []);
      addNotification(`${data.nickname} joined the room`);
    };

    const handleUserLeft = (data) => {
      setUsers(data.users || []);
      setRemoteCursors(prev => { const n = { ...prev }; delete n[data.userId]; return n; });
      if (data.kicked) {
        addNotification(`${data.nickname} was kicked from the room.`);
      } else {
        addNotification(`${data.nickname} left the room`);
      }
      if (data.sessionId) Object.keys(peerConnectionsRef.current).forEach(sid => cleanupPeerConnection(sid));
    };

    const handleChatMessage = (msg) => setChatMessages(prev => [...prev, msg]);
    const handleLanguageUpdate = (data) => setLanguage(data.language);

    const handleFileUpdate = (data) => {
      setActiveFile(data.filename);
      setFiles(prev => ({ ...prev, [data.filename]: data.content }));
    };

    const handleFileDeleted = (data) => {
      setFiles(prev => {
        const next = {};
        (data.files || []).forEach(f => { next[f] = prev[f] ?? ''; });
        return next;
      });
      setActiveFile(data.activeFile);
    };

    const handleCameraToggle = (data) => setUsers(data.users || []);
    const handleMicToggle = (data) => setUsers(data.users || []);

    const handleTerminalOutput = (data) => {
      if (data.output) setTerminalLines(prev => [...prev, { type: 'output', text: data.output }]);
      if (data.done) setIsRunning(false);
    };

    // --- WebRTC ---
    const handleWebrtcOffer = async (data) => {
      console.log('[WebRTC] Received offer from', data.fromSid);
      if (data.fromUserId) sidToUserIdRef.current[data.fromSid] = data.fromUserId;
      const pc = createPeerConnection(data.fromSid);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', { targetSid: data.fromSid, answer: pc.localDescription });
      } catch (err) { console.error('[WebRTC] Err handling offer:', err); }
    };

    const handleWebrtcAnswer = async (data) => {
      console.log('[WebRTC] Received answer from', data.fromSid);
      const pc = peerConnectionsRef.current[data.fromSid];
      if (pc) {
        try { await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); }
        catch (err) { console.error('[WebRTC] Err handling answer:', err); }
      }
    };

    const handleWebrtcIce = async (data) => {
      const pc = peerConnectionsRef.current[data.fromSid];
      if (pc && data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
        catch (err) { console.error('[WebRTC] Err adding ICE:', err); }
      }
    };

    /* Register handlers */
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('room_joined', handleRoomJoined);
    socket.on('join_error', handleJoinError);
    socket.on('join_pending', handleJoinPending);
    socket.on('pending_join_request', handlePendingJoinRequest);
    socket.on('join_approved', handleJoinApproved);
    socket.on('join_rejected', handleJoinRejected);
    socket.on('role_changed', handleRoleChanged);
    socket.on('user_kicked', handleUserKicked);
    socket.on('code_update', handleCodeUpdate);
    socket.on('cursor_update', handleCursorUpdate);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('chat_message', handleChatMessage);
    socket.on('language_update', handleLanguageUpdate);
    socket.on('file_update', handleFileUpdate);
    socket.on('file_deleted', handleFileDeleted);
    socket.on('camera_toggle', handleCameraToggle);
    socket.on('mic_toggle', handleMicToggle);
    socket.on('terminal_output', handleTerminalOutput);
    socket.on('webrtc_offer', handleWebrtcOffer);
    socket.on('webrtc_answer', handleWebrtcAnswer);
    socket.on('webrtc_ice', handleWebrtcIce);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('room_joined', handleRoomJoined);
      socket.off('join_error', handleJoinError);
      socket.off('join_pending', handleJoinPending);
      socket.off('pending_join_request', handlePendingJoinRequest);
      socket.off('join_approved', handleJoinApproved);
      socket.off('join_rejected', handleJoinRejected);
      socket.off('role_changed', handleRoleChanged);
      socket.off('user_kicked', handleUserKicked);
      socket.off('code_update', handleCodeUpdate);
      socket.off('cursor_update', handleCursorUpdate);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('chat_message', handleChatMessage);
      socket.off('language_update', handleLanguageUpdate);
      socket.off('file_update', handleFileUpdate);
      socket.off('file_deleted', handleFileDeleted);
      socket.off('camera_toggle', handleCameraToggle);
      socket.off('mic_toggle', handleMicToggle);
      socket.off('terminal_output', handleTerminalOutput);
      socket.off('webrtc_offer', handleWebrtcOffer);
      socket.off('webrtc_answer', handleWebrtcAnswer);
      socket.off('webrtc_ice', handleWebrtcIce);
      Object.keys(peerConnectionsRef.current).forEach(sid => cleanupPeerConnection(sid));
    };
  }, [roomId, nickname, userId, dbUserId, roomPassword, addNotification, createPeerConnection, cleanupPeerConnection, navigate]);


  /* ========== Action Handlers ========== */
  const handleApproveRequest = (dbUserIdToApprove, username, role) => {
    socket.emit('approve_join', { roomCode: roomId, dbUserId: dbUserIdToApprove, role });
    setPendingRequests(prev => prev.filter(req => req.dbUserId !== dbUserIdToApprove));
  };

  const handleRejectRequest = (dbUserIdToReject) => {
    socket.emit('reject_join', { roomCode: roomId, dbUserId: dbUserIdToReject });
    setPendingRequests(prev => prev.filter(req => req.dbUserId !== dbUserIdToReject));
  };

  const handleChangeRole = (targetDbUserId, newRole) => {
    socket.emit('change_role', { roomCode: roomId, dbUserId: targetDbUserId, role: newRole });
  };

  const handleKickUser = (targetDbUserId) => {
    if (window.confirm('Are you sure you want to kick this user?')) {
      socket.emit('kick_user', { roomCode: roomId, dbUserId: targetDbUserId });
    }
  };

  const handleCodeChange = (value) => {
    if (!canWrite(myRole)) return; // read-only protection
    const next = value || '';
    const key = `${activeFile}::${next}`;
    if (lastRemoteCodeRef.current === key) {
      lastRemoteCodeRef.current = null;
      setFiles(prev => ({ ...prev, [activeFile]: next }));
      return;
    }
    setFiles(prev => ({ ...prev, [activeFile]: next }));
    socket.emit('code_change', { room: roomId, code: next, filename: activeFile, userId });
  };

  const handleCursorMove = (pos) => {
    socket.emit('cursor_move', {
      room: roomId, userId, nickname: displayNickname, cursorColor,
      line: pos.lineNumber, column: pos.column,
    });
  };

  const handleLanguageChange = (lang) => {
    if (!canWrite(myRole)) return;
    setLanguage(lang);
    socket.emit('language_change', { room: roomId, language: lang });
  };

  const handleRunCode = () => {
    const code = files[activeFile] || '';
    setIsRunning(true);
    setTerminalLines(prev => [...prev, { type: 'status', text: '$ Running...' }]);
    socket.emit('run_code', { room: roomId, code, language });
  };

  const handleTerminalInput = (text) => {
    if (text && text !== '\x03') setTerminalLines(prev => [...prev, { type: 'input', text }]);
    socket.emit('terminal_input', { text: text + '\n' });
  };

  const handleSendChat = (text) => {
    socket.emit('chat_message', { room: roomId, userId, nickname: displayNickname, text });
  };

  const handleSwitchFile = (filename) => {
    setActiveFile(filename);
    socket.emit('file_change', { room: roomId, filename, action: 'switch' });
  };

  const handleCreateFile = (filename) => {
    if (!canWrite(myRole)) return;
    const ext = filename.split('.').pop();
    const defaults = { py: '# New file\n', js: '// New file\n', cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n', java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n' };
    const content = defaults[ext] || '';
    setFiles(prev => ({ ...prev, [filename]: content }));
    setActiveFile(filename);
    socket.emit('file_change', { room: roomId, filename, content, action: 'create' });
  };

  const handleDeleteFile = (filename) => {
    if (!canWrite(myRole)) return;
    socket.emit('delete_file', { room: roomId, filename });
  };

  const handleCameraToggle = (enabled) => {
    setUsers(prev => prev.map(u => u.userId === userId ? { ...u, cameraEnabled: enabled } : u));
    socket.emit('camera_toggle', { room: roomId, userId, enabled });
  };

  const handleMicToggle = (enabled) => {
    setUsers(prev => prev.map(u => u.userId === userId ? { ...u, micEnabled: enabled } : u));
    socket.emit('mic_toggle', { room: roomId, userId, enabled });
  };

  const handleLocalStream = useCallback((stream) => {
    console.log('[WebRTC] Storing local stream with tracks:', stream.getTracks().length);
    localStreamRef.current = stream;
    Object.values(peerConnectionsRef.current).forEach(pc => {
      const existingSenders = pc.getSenders();
      stream.getTracks().forEach(track => {
        const existing = existingSenders.find(s => s.track && s.track.kind === track.kind);
        if (existing) {
          existing.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      });
    });
  }, []);

  const copyRoomId = () => {
    copyToClipboard(roomId)
      .then(() => addNotification('Room ID copied!'))
      .catch(() => addNotification('Copy failed — please copy manually: ' + roomId));
  };

  const handleLeaveRoom = () => {
    hasJoinedRef.current = false;
    Object.keys(peerConnectionsRef.current).forEach(sid => cleanupPeerConnection(sid));
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    navigate('/');
  };


  /* ========== Resizer drag handlers ========== */
  // ... (keeping resize logic exactly the same)
  const handleTerminalResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalHeight;
    const onMove = (ev) => setTerminalHeight(Math.max(80, Math.min(startH + startY - ev.clientY, window.innerHeight - 200)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; };
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  const handleSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => setSidebarWidth(Math.max(200, Math.min(startW + startX - ev.clientX, 600)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const handleUsersChatResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = usersPanelHeight;
    const onMove = (ev) => setUsersPanelHeight(Math.max(80, Math.min(startH + ev.clientY - startY, 500)));
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; };
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [usersPanelHeight]);


  /* ========== Render ========== */
  if (joinError) {
    return (
      <div className="join-error-page">
        <div className="join-error-card">
          <div className="join-error-icon">⚠️</div>
          <h2>Access Denied</h2>
          <p>{joinError}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>
        </div>
      </div>
    );
  }

  if (joinPending) {
    return (
      <div className="join-error-page">
        <div className="join-error-card">
          <div className="auth-loading-spinner" style={{ marginBottom: '1rem', width: '40px', height: '40px' }} />
          <h2>Joining Room...</h2>
          <p>{joinPending}</p>
          <button className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={() => navigate('/')}>Cancel</button>
        </div>
      </div>
    );
  }


  return (
    <div className="room-page">
      {/* Toast notifications */}
      <div className="notifications">
        {notifications.map(n => (
          <div key={n.id} className="notification">{n.text}</div>
        ))}
      </div>

      {/* Admin Pending Join Requests Modal/Overlay */}
      {pendingRequests.length > 0 && ['admin', 'deputy_admin'].includes(myRole) && (
        <div className="admin-approval-overlay">
          {pendingRequests.map(req => (
            <div key={req.dbUserId} className="admin-approval-card">
              <h4>Join Request</h4>
              <p><strong>{req.username}</strong> wants to join the room.</p>
              <div className="admin-approval-actions">
                <select id={`role-select-${req.dbUserId}`} defaultValue="viewer" className="input-field" style={{ padding: '4px', width: 'auto' }}>
                  <option value="deputy_admin">⭐ Deputy Admin</option>
                  <option value="editor">✏️ Editor</option>
                  <option value="reviewer">🔍 Reviewer</option>
                  <option value="viewer">👁️ Viewer</option>
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const sel = document.getElementById(`role-select-${req.dbUserId}`);
                    handleApproveRequest(req.dbUserId, req.username, sel.value);
                  }}
                >
                  Approve
                </button>
                <button
                  className="btn btn-sm"
                  style={{ background: 'rgba(243,139,168,.15)', color: 'var(--red)' }}
                  onClick={() => handleRejectRequest(req.dbUserId)}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <header className="room-header">
        <div className="room-header-left">
          <span className="room-logo">CodeSync</span>
          <div className="room-id-badge" onClick={copyRoomId} title="Click to copy Room ID">
            <span className="room-id-label">Room</span>
            <span className="room-id-value">{roomId}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </div>
        </div>
        <div className="room-header-right">
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{displayNickname}</span>
          <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Reconnecting…'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={handleLeaveRoom}>Leave</button>
        </div>
      </header>

      {/* Layout */}
      <div className="room-content">
        <FilesSidebar
          files={Object.keys(files)}
          activeFile={activeFile}
          onSwitch={handleSwitchFile}
          onCreate={handleCreateFile}
          onDelete={handleDeleteFile}
          readOnly={!canWrite(myRole)}
        />
        <div className="room-left">
          {/* We pass readOnly state to EditorPanel via pointerEvents or monaco options */}
          <div className="editor-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, opacity: canWrite(myRole) ? 1 : 0.8 }}>
            {!canWrite(myRole) && (
              <div className="readonly-banner">
                You are in Read-Only mode ({myRole === 'viewer' ? 'Viewer' : 'Reviewer'}). Your changes will not be saved.
              </div>
            )}
            <EditorPanel
              code={files[activeFile] || ''}
              language={language}
              activeFile={activeFile}
              remoteCursors={Object.values(remoteCursors)}
              onCodeChange={handleCodeChange}
              onCursorMove={handleCursorMove}
              onLanguageChange={handleLanguageChange}
              onRun={handleRunCode}
              isRunning={isRunning}
              readOnly={!canWrite(myRole)}
            />
          </div>

          <div className="resizer resizer-horizontal" onMouseDown={handleTerminalResize} />
          <TerminalPanel
            lines={terminalLines}
            isRunning={isRunning}
            onRunCommand={() => {}} 
            onTerminalInput={handleTerminalInput}
            onClear={() => setTerminalLines([])}
            height={terminalHeight}
          />
        </div>

        <div className="resizer resizer-vertical" onMouseDown={handleSidebarResize} />

        <div className="room-right" style={{ width: sidebarWidth, minWidth: 200, maxWidth: 600 }}>
          <UsersPanel
            users={users}
            currentUserId={userId}
            onCameraToggle={handleCameraToggle}
            onMicToggle={handleMicToggle}
            onLocalStream={handleLocalStream}
            remoteStreams={remoteStreams}
            height={usersPanelHeight}
            myRole={myRole}
            onChangeRole={handleChangeRole}
            onKickUser={handleKickUser}
          />
          <div className="resizer resizer-horizontal" onMouseDown={handleUsersChatResize} />
          <ChatPanel messages={chatMessages} onSend={handleSendChat} currentUserId={userId} />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
