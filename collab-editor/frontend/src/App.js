import { useRef, useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './App.css';
import LandingPage from './components/LandingPage';
import RoomPage from './components/RoomPage';
import LoginPage from './components/LoginPage';
import SignupPage from './components/SignupPage';
import { BACKEND_URL } from './socket';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const userIdRef = useRef(
    sessionStorage.getItem('codesync_userId') ||
    (() => {
      const id = `user-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem('codesync_userId', id);
      return id;
    })()
  );

  // Check auth status on mount
  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/me`, { credentials: 'include' });
      const data = await res.json();
      if (data.authenticated && data.user) {
        setCurrentUser(data.user);
        sessionStorage.setItem('codesync_userId', `user-${data.user.id}`);
        sessionStorage.setItem('codesync_nickname', data.user.username);
        sessionStorage.setItem('codesync_dbUserId', String(data.user.id));
        sessionStorage.setItem('codesync_username', data.user.username);
        userIdRef.current = `user-${data.user.id}`;
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogin = (user) => {
    setCurrentUser(user);
    userIdRef.current = `user-${user.id}`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/logout`, { credentials: 'include' });
    } catch {}
    sessionStorage.clear();
    setCurrentUser(null);
  };

  if (!authChecked) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={
        currentUser ? <Navigate to="/" replace /> : <LoginPage onLogin={handleLogin} />
      } />
      <Route path="/signup" element={
        currentUser ? <Navigate to="/" replace /> : <SignupPage />
      } />
      <Route path="/" element={
        currentUser ? <LandingPage currentUser={currentUser} onLogout={handleLogout} /> : <Navigate to="/login" replace />
      } />
      <Route
        path="/room/:roomId"
        element={
          currentUser
            ? <RoomPage userId={userIdRef.current} currentUser={currentUser} onLogout={handleLogout} />
            : <Navigate to="/login" replace />
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
