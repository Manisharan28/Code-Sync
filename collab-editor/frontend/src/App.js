import { useRef } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import LandingPage from './components/LandingPage';
import RoomPage from './components/RoomPage';

function App() {
  const userIdRef = useRef(
    sessionStorage.getItem('codesync_userId') ||
    (() => {
      const id = `user-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('codesync_userId', id);
      return id;
    })()
  );

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route
        path="/room/:roomId"
        element={<RoomPage userId={userIdRef.current} />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
