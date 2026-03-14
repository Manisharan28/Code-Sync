import { io } from 'socket.io-client';

// Use environment variable or default to the current host IP
export const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || `http://${window.location.hostname}:5000`;

export const socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket'],
  withCredentials: true,
});