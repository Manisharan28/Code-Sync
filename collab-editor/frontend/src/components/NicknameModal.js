import { useState } from 'react';

function NicknameModal({ roomId, isCreating, onSubmit, onClose }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">
          {isCreating ? 'Create a New Room' : 'Join a Room'}
        </h2>

        <div className="modal-room-info">
          <span className="modal-label">Room ID</span>
          <span className="modal-room-value">{roomId}</span>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="modal-label" htmlFor="nickname-input">
            Choose your nickname
          </label>
          <input
            id="nickname-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. DevMaster42"
            className="input-field"
            maxLength={20}
            autoFocus
          />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              {isCreating ? 'Create & Enter' : 'Join Room'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default NicknameModal;
