import { useState, useRef } from 'react';
import './App.css';
import LandingPage from './components/LandingPage';
import NicknameModal from './components/NicknameModal';
import RoomPage from './components/RoomPage';

function App() {
  const [page, setPage] = useState('landing');
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const userIdRef = useRef(`user-${Math.random().toString(36).slice(2, 8)}`);

  const generateRoomId = () => Math.random().toString(36).slice(2, 8);

  const handleCreateRoom = () => {
    setRoomId(generateRoomId());
    setIsCreating(true);
    setPage('nickname');
  };

  const handleJoinRoom = (id) => {
    setRoomId(id);
    setIsCreating(false);
    setPage('nickname');
  };

  const handleNicknameSubmit = (name) => {
    setNickname(name);
    setPage('room');
  };

  const handleLeaveRoom = () => {
    setPage('landing');
    setRoomId('');
    setNickname('');
  };

  if (page === 'room' && roomId && nickname) {
    return (
      <RoomPage
        roomId={roomId}
        nickname={nickname}
        userId={userIdRef.current}
        onLeave={handleLeaveRoom}
      />
    );
  }

  return (
    <div className="app-container">
      <LandingPage onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} />
      {page === 'nickname' && (
        <NicknameModal
          roomId={roomId}
          isCreating={isCreating}
          onSubmit={handleNicknameSubmit}
          onClose={() => setPage('landing')}
        />
      )}
    </div>
  );
}

export default App;
