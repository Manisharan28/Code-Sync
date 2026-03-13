import { io } from 'socket.io-client';

// LAN IP — so friends on same network can connect
// Update this if your IP changes (run ipconfig to check)
export const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://172.16.9.151:5000';

export const socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket'],
});