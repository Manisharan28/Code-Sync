import { useState, useEffect, useRef } from 'react';

function ChatPanel({ messages, onSend, currentUserId }) {
  const [text, setText] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (text.trim()) {
      onSend(text.trim());
      setText('');
    }
  };

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <h3>Team Chat</h3>
      </div>
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">No messages yet. Say hello! 👋</div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`chat-msg ${msg.userId === currentUserId ? 'chat-msg-self' : ''}`}
          >
            <div className="chat-msg-header">
              <span className="chat-msg-author">{msg.nickname}</span>
              <span className="chat-msg-time">{formatTime(msg.timestamp)}</span>
            </div>
            <p className="chat-msg-text">{msg.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="chat-input"
        />
        <button type="submit" className="btn btn-send" disabled={!text.trim()}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

export default ChatPanel;
