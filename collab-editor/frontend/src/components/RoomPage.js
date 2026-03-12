import { useEffect, useRef, useState, useCallback } from 'react';
import { socket, BACKEND_URL } from '../socket';
import EditorPanel from './EditorPanel';
import TerminalPanel from './TerminalPanel';
import UsersPanel from './UsersPanel';
import ChatPanel from './ChatPanel';

function RoomPage({ roomId, nickname, userId, onLeave }) {
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState('python');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [users, setUsers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [cursorColor, setCursorColor] = useState('#89b4fa');

  const lastRemoteCodeRef = useRef(null);
  const notifIdRef = useRef(0);

  /* ---- toast notifications ---- */
  const addNotification = useCallback((text) => {
    const id = ++notifIdRef.current;
    setNotifications((prev) => [...prev, { id, text }]);
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 3000);
  }, []);

  /* ---- socket event wiring ---- */
  useEffect(() => {
    const handleConnect = () => {
      socket.emit('join_room', { room: roomId, nickname, userId });
    };

    const handleRoomJoined = (data) => {
      setCode(data.code || '');
      setLanguage(data.language || 'python');
      setUsers(data.users || []);
      setChatMessages(data.chat || []);
      setCursorColor(data.cursorColor || '#89b4fa');
    };

    const handleCodeUpdate = (data) => {
      lastRemoteCodeRef.current = data.code;
      setCode(data.code || '');
    };

    const handleCursorUpdate = (data) => {
      if (data.userId === userId) return;
      setRemoteCursors((prev) => ({ ...prev, [data.userId]: data }));
    };

    const handleUserJoined = (data) => {
      setUsers(data.users || []);
      addNotification(`${data.nickname} joined the room`);
    };

    const handleUserLeft = (data) => {
      setUsers(data.users || []);
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[data.userId];
        return next;
      });
      addNotification(`${data.nickname} left the room`);
    };

    const handleChatMessage = (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    };

    const handleLanguageUpdate = (data) => {
      setLanguage(data.language);
    };

    socket.on('room_joined', handleRoomJoined);
    socket.on('code_update', handleCodeUpdate);
    socket.on('cursor_update', handleCursorUpdate);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('chat_message', handleChatMessage);
    socket.on('language_update', handleLanguageUpdate);

    if (socket.connected) handleConnect();
    else socket.on('connect', handleConnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('room_joined', handleRoomJoined);
      socket.off('code_update', handleCodeUpdate);
      socket.off('cursor_update', handleCursorUpdate);
      socket.off('user_joined', handleUserJoined);
      socket.off('user_left', handleUserLeft);
      socket.off('chat_message', handleChatMessage);
      socket.off('language_update', handleLanguageUpdate);
    };
  }, [roomId, nickname, userId, addNotification]);

  /* ---- handlers ---- */
  const handleCodeChange = (value) => {
    const next = value || '';
    if (lastRemoteCodeRef.current === next) {
      lastRemoteCodeRef.current = null;
      setCode(next);
      return;
    }
    setCode(next);
    socket.emit('code_change', { room: roomId, code: next, userId });
  };

  const handleCursorMove = (pos) => {
    socket.emit('cursor_move', {
      room: roomId,
      userId,
      nickname,
      cursorColor,
      line: pos.lineNumber,
      column: pos.column,
    });
  };

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    socket.emit('language_change', { room: roomId, language: lang });
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    setOutput('$ Running...\n');
    try {
      const res = await fetch(`${BACKEND_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, language }),
      });
      const data = await res.json();
      const out = [data.stdout, data.stderr].filter(Boolean).join('\n')
        || 'Program completed with no output.';
      setOutput(out);
    } catch (err) {
      setOutput(`Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSendChat = (text) => {
    socket.emit('chat_message', { room: roomId, userId, nickname, text });
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => addNotification('Room ID copied!'));
  };

  return (
    <div className="room-page">
      {/* Toast notifications */}
      <div className="notifications">
        {notifications.map((n) => (
          <div key={n.id} className="notification">{n.text}</div>
        ))}
      </div>

      {/* Header bar */}
      <header className="room-header">
        <div className="room-header-left">
          <span className="room-logo">CodeSync</span>
          <div className="room-id-badge" onClick={copyRoomId} title="Click to copy">
            <span className="room-id-label">Room</span>
            <span className="room-id-value">{roomId}</span>
          </div>
        </div>
        <div className="room-header-right">
          <span className="user-count-badge">{users.length} online</span>
          <button className="btn btn-ghost btn-sm" onClick={onLeave}>Leave Room</button>
        </div>
      </header>

      {/* Two-column layout */}
      <div className="room-content">
        <div className="room-left">
          <EditorPanel
            code={code}
            language={language}
            remoteCursors={Object.values(remoteCursors)}
            onCodeChange={handleCodeChange}
            onCursorMove={handleCursorMove}
            onLanguageChange={handleLanguageChange}
            onRun={handleRunCode}
            isRunning={isRunning}
          />
          <TerminalPanel output={output} />
        </div>

        <div className="room-right">
          <UsersPanel users={users} currentUserId={userId} />
          <ChatPanel messages={chatMessages} onSend={handleSendChat} currentUserId={userId} />
        </div>
      </div>
    </div>
  );
}

export default RoomPage;
