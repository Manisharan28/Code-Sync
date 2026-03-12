import { io } from 'socket.io-client';

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://172.16.9.146:5000';

export const socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket'],
});