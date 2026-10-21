import { io } from 'socket.io-client';

const hostname = window.location.hostname;
const SERVER_URL = (!hostname || hostname === 'localhost') 
  ? 'http://localhost:4000' 
  : `http://${hostname}:4000`;

export const socket = io(SERVER_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});
