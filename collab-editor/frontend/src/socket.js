import { io } from 'socket.io-client';

// Default to local backend unless overridden by REACT_APP_BACKEND_URL
export const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';

export const socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket'],
});