/*
  RoomPage — Main room view with WebRTC, terminal I/O, resizable panels, file delete,
  session_id dedup, and duplicate notification fix.

  Socket.IO events used (client→server):
    join_room, code_change, cursor_move, chat_message, language_change,
    file_change, delete_file, camera_toggle, mic_toggle,
    run_code, terminal_input,
    webrtc_offer, webrtc_answer, webrtc_ice
*/
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket, BACKEND_URL } from '../socket';
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

/* ---------- unique session ID per tab (not persisted) ---------- */
const SESSION_ID = crypto.randomUUID ? crypto.randomUUID() : `s-${Math.random().toString(36).slice(2)}`;

/* ---------- WebRTC config ---------- */
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function RoomPage({ userId }) {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const nickname = sessionStorage.getItem('codesync_nickname') || 'Anonymous';
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
  const [displayNickname, setDisplayNickname] = useState(nickname);

  /* ---- refs ---- */
  const lastRemoteCodeRef = useRef(null);
  const notifIdRef = useRef(0);
  const hasJoinedRef = useRef(false);
  const peerConnectionsRef = useRef({});  // sid → RTCPeerConnection
  const localStreamRef = useRef(null);
  const remoteStreamsRef = useRef({});     // userId → MediaStream
  const sidToUserIdRef = useRef({});       // socketSid → userId (for WebRTC stream lookup)
  const [remoteStreams, setRemoteStreams] = useState({}); // userId → MediaStream, for re-renders

  /* ---- resizable panel sizes ---- */
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [usersPanelHeight, setUsersPanelHeight] = useState(250);

  /* ---- toast notifications ---- */
  const addNotification = useCallback((text) => {
    const id = ++notifIdRef.current;
    setNotifications(prev => [...prev, { id, text }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3000);
  }, []);

  /* ========== WebRTC helpers ========== */
  const createPeerConnection = useCallback((remoteSid) => {
    if (peerConnectionsRef.current[remoteSid]) return peerConnectionsRef.current[remoteSid];
    const pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('webrtc_ice', { targetSid: remoteSid, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) {
        // Key by userId so UsersPanel can look up by user.userId
        const remoteUserId = sidToUserIdRef.current[remoteSid] || remoteSid;
        remoteStreamsRef.current[remoteUserId] = stream;
        setRemoteStreams(prev => ({ ...prev, [remoteUserId]: stream }));
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_offer', {
          targetSid: remoteSid,
          offer: pc.localDescription,
          fromUserId: userId,
          fromNickname: displayNickname,
        });
      } catch (err) {
        console.error('WebRTC negotiation error:', err);
      }
    };

    // Add local tracks if we have a stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));
    }

    peerConnectionsRef.current[remoteSid] = pc;
    return pc;
  }, [userId, displayNickname]);

  const cleanupPeerConnection = useCallback((remoteSid) => {
    const pc = peerConnectionsRef.current[remoteSid];
    if (pc) {
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
      setFiles(data.files || { 'main.py': '' });
      setActiveFile(data.activeFile || 'main.py');
      setLanguage(data.language || 'python');
      setUsers(data.users || []);
      setChatMessages(data.chat || []);
      setCursorColor(data.cursorColor || '#89b4fa');
      if (data.nickname) setDisplayNickname(data.nickname);

      // Initiate WebRTC with all existing users (they have sids in socket.id form)
      // We'll get their sids from user_joined events
    };

    const handleJoinError = (data) => {
      setJoinError(data.message || 'Could not join room.');
    };

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
      addNotification(`${data.nickname} left the room`);
      // Cleanup WebRTC for departed user
      if (data.sessionId) {
        Object.keys(peerConnectionsRef.current).forEach(sid => {
          cleanupPeerConnection(sid);
        });
      }
    };

    const handleChatMessage = (msg) => setChatMessages(prev => [...prev, msg]);
    const handleLanguageUpdate = (data) => setLanguage(data.language);

    const handleFileUpdate = (data) => {
      setActiveFile(data.filename);
      setFiles(prev => ({ ...prev, [data.filename]: data.content }));
    };

    const handleFileDeleted = (data) => {
      // Use server's authoritative file list to rebuild state
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
      if (data.output) {
        setTerminalLines(prev => [...prev, { type: 'output', text: data.output }]);
      }
      if (data.done) {
        setIsRunning(false);
      }
    };

    /* WebRTC signaling handlers */
    const handleWebrtcOffer = async (data) => {
      // Map socket sid → userId so ontrack can key remoteStreams by userId
      if (data.fromUserId) {
        sidToUserIdRef.current[data.fromSid] = data.fromUserId;
      }
      const pc = createPeerConnection(data.fromSid);
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc_answer', { targetSid: data.fromSid, answer: pc.localDescription });
      } catch (err) {
        console.error('Error handling WebRTC offer:', err);
      }
    };

    const handleWebrtcAnswer = async (data) => {
      const pc = peerConnectionsRef.current[data.fromSid];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) {
          console.error('Error handling WebRTC answer:', err);
        }
      }
    };

    const handleWebrtcIce = async (data) => {
      const pc = peerConnectionsRef.current[data.fromSid];
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    };

    /* Register all handlers */
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('room_joined', handleRoomJoined);
    socket.on('join_error', handleJoinError);
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
      // Cleanup all peer connections on unmount
      Object.keys(peerConnectionsRef.current).forEach(sid => cleanupPeerConnection(sid));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, nickname, userId, roomPassword, addNotification, createPeerConnection, cleanupPeerConnection]);

  /* ========== Handlers ========== */
  const handleCodeChange = (value) => {
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
    setLanguage(lang);
    socket.emit('language_change', { room: roomId, language: lang });
  };

  const handleRunCode = () => {
    // Route through socket so the process is interactive (stdin works)
    const code = files[activeFile] || '';
    setIsRunning(true);
    setTerminalLines(prev => [...prev, { type: 'status', text: '$ Running...' }]);
    socket.emit('run_code', { room: roomId, code, language });
  };

  const handleRunCommand = (code) => {
    setIsRunning(true);
    setTerminalLines(prev => [...prev, { type: 'input', text: code }]);
    socket.emit('run_code', { room: roomId, code, language });
  };

  const handleTerminalInput = (text) => {
    // Echo the input into terminal lines so user sees what they typed
    if (text && text !== '\x03') {
      setTerminalLines(prev => [...prev, { type: 'input', text }]);
    }
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
    const ext = filename.split('.').pop();
    const defaults = { py: '# New file\n', js: '// New file\n', cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n', java: 'public class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n' };
    const content = defaults[ext] || '';
    setFiles(prev => ({ ...prev, [filename]: content }));
    setActiveFile(filename);
    socket.emit('file_change', { room: roomId, filename, content, action: 'create' });
  };

  const handleDeleteFile = (filename) => {
    socket.emit('delete_file', { room: roomId, filename });
  };

  const handleCameraToggle = (enabled) => {
    // Bug 1 fix: update local users state immediately (backend uses include_self=False)
    setUsers(prev => prev.map(u => u.userId === userId ? { ...u, cameraEnabled: enabled } : u));
    socket.emit('camera_toggle', { room: roomId, userId, enabled });
  };

  const handleMicToggle = (enabled) => {
    // Bug 1 fix: update local users state immediately (backend uses include_self=False)
    setUsers(prev => prev.map(u => u.userId === userId ? { ...u, micEnabled: enabled } : u));
    socket.emit('mic_toggle', { room: roomId, userId, enabled });
  };

  const handleLocalStream = useCallback((stream) => {
    localStreamRef.current = stream;
    // Add tracks to all existing peer connections
    Object.values(peerConnectionsRef.current).forEach(pc => {
      const existingSenders = pc.getSenders();
      stream.getTracks().forEach(track => {
        const existing = existingSenders.find(s => s.track?.kind === track.kind);
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
    // Cleanup all peer connections
    Object.keys(peerConnectionsRef.current).forEach(sid => cleanupPeerConnection(sid));
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    navigate('/');
  };

  const handleClearTerminal = () => setTerminalLines([]);

  /* ========== Resizer drag handlers ========== */
  const handleTerminalResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = terminalHeight;
    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      setTerminalHeight(Math.max(80, Math.min(startH + delta, window.innerHeight - 200)));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  const handleSidebarResize = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev) => {
      const delta = startX - ev.clientX;
      setSidebarWidth(Math.max(200, Math.min(startW + delta, 600)));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const handleUsersChatResize = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = usersPanelHeight;
    const onMove = (ev) => {
      const delta = ev.clientY - startY;
      setUsersPanelHeight(Math.max(80, Math.min(startH + delta, 500)));
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [usersPanelHeight]);

  /* ========== Render ========== */
  if (joinError) {
    return (
      <div className="join-error-page">
        <div className="join-error-card">
          <div className="join-error-icon">⚠️</div>
          <h2>Cannot Join Room</h2>
          <p>{joinError}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>
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
          <span className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {connected ? 'Connected' : 'Reconnecting…'}
          </span>
          <span className="user-count-badge">{users.length} online</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLeaveRoom}>Leave Room</button>
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
        />
        <div className="room-left">
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
          />
          {/* Horizontal resizer between editor and terminal */}
          <div className="resizer resizer-horizontal" onMouseDown={handleTerminalResize} />
          <TerminalPanel
            lines={terminalLines}
            isRunning={isRunning}
            onRunCommand={handleRunCommand}
            onTerminalInput={handleTerminalInput}
            onClear={handleClearTerminal}
            height={terminalHeight}
          />
        </div>

        {/* Vertical resizer between left and right panels */}
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
          />
          {/* Horizontal resizer between users and chat */}
          <div className="resizer resizer-horizontal" onMouseDown={handleUsersChatResize} />
          <ChatPanel messages={chatMessages} onSend={handleSendChat} currentUserId={userId} />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
