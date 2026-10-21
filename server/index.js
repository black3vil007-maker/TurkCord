import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// State in memory
// Users: { [socketId]: { id, username, avatar, currentVoiceRoom, isMuted, isDeafened, isScreenSharing } }
const users = {};

// Channels config
const channels = {
  text: [
    { id: 'genel', name: 'genel-sohbet', description: 'Herkesin sohbet edebileceği ana kanal' },
    { id: 'oyunlar', name: 'oyun-tavsiyeleri', description: 'Oyun linkleri, taktikler ve sohbet' },
    { id: 'duyurular', name: 'duyurular', description: 'Sunucu duyuruları' }
  ],
  voice: [
    { id: 'voice-lobi', name: 'Lobi', limit: 10 },
    { id: 'voice-oyun-1', name: 'Oyun Odası #1 (Squad)', limit: 5 },
    { id: 'voice-oyun-2', name: 'Oyun Odası #2 (Duo)', limit: 2 },
    { id: 'voice-muhabbet', name: 'Sessiz / Chill', limit: 8 }
  ]
};

// In-memory text messages: { [channelId]: [ { id, sender, text, timestamp, avatar } ] }
const channelMessages = {
  'genel': [
    {
      id: 'welcome-msg',
      sender: { id: 'system', username: 'TurkCord Bot', avatar: '🤖' },
      text: 'TurkCord sunucusuna hoş geldiniz! Sol menüden ses odalarına katılabilir ve arkadaşlarınızla sıfır gecikmeli sesli/görüntülü sohbet edebilirsiniz.',
      timestamp: new Date().toISOString()
    }
  ],
  'oyunlar': [],
  'duyurular': []
};

// Voice rooms: { [roomId]: Set of socketIds }
const voiceRooms = {};
channels.voice.forEach(v => {
  voiceRooms[v.id] = new Set();
});

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // User join / handshake
  socket.on('user:join', ({ id, username, avatar, user_code, email }) => {
    // Güvenlik Önlemi: Hesabı olmayan veya giriş yapmamış kullanıcılar kanallara ve mesajlara erişemez
    if (!id || !username || typeof username !== 'string' || !username.trim()) {
      console.warn(`[Security] Yetkisiz bağlantı isteği engellendi: ${socket.id}`);
      socket.emit('auth:error', { message: 'Oturum açmadan kanallara ve sohbet geçmişine erişilemez.' });
      return;
    }

    const isAdmin = Boolean(email && email.toLowerCase() === 'aerayyoruk@gmail.com');

    users[socket.id] = {
      socketId: socket.id,
      id: id,
      email: email || null,
      isAdmin: isAdmin,
      isPassive: false,
      username: username.trim(),
      avatar: avatar || '🎮',
      user_code: user_code || null,
      currentVoiceRoom: null,
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      isForceMuted: false
    };

    // Send initial configuration to the joining user
    socket.emit('init:state', {
      channels,
      users: Object.values(users),
      voiceRooms: getVoiceRoomsData(),
      messages: channelMessages
    });

    // Broadcast updated users list
    io.emit('users:updated', Object.values(users));
  });

  // ============================================================
  // SİSTEM YÖNETİCİSİ (ADMIN) İŞLEMLERİ: aerayyoruk@gmail.com
  // ============================================================

  // 1. Odadan Atma (Admin Kick)
  socket.on('admin:kick', ({ targetUserId, reason }) => {
    const caller = users[socket.id];
    if (!caller || !caller.isAdmin) {
      console.warn('[Admin] Yetkisiz kick girişimi engellendi:', socket.id);
      return;
    }

    const targetSocket = Object.values(users).find(u => u.id === targetUserId);
    if (targetSocket) {
      const oldRoomId = targetSocket.currentVoiceRoom;
      if (oldRoomId && voiceRooms[oldRoomId]) {
        voiceRooms[oldRoomId].delete(targetSocket.socketId);
      }
      targetSocket.currentVoiceRoom = null;

      // Kullanıcıya atıldığını bildir
      io.to(targetSocket.socketId).emit('admin:kicked', {
        roomId: oldRoomId,
        reason: reason || 'Yönetici tarafından ses odasından çıkarıldınız.'
      });

      // Diğer kullanıcılara bildir
      io.emit('voice:rooms-updated', getVoiceRoomsData());
      io.emit('users:updated', Object.values(users));
      if (oldRoomId) {
        io.to(oldRoomId).emit('voice:user-left', { peerId: targetSocket.socketId });
      }
      console.log(`[Admin] ${caller.username} kullanıcısı ${targetSocket.username} kişisini odadan attı.`);
    }
  });

  // 2. Kişiyi Sessize Alma / Kilidini Açma (Admin Server Mute)
  socket.on('admin:mute', ({ targetUserId, isMuted }) => {
    const caller = users[socket.id];
    if (!caller || !caller.isAdmin) return;

    const targetSocket = Object.values(users).find(u => u.id === targetUserId);
    if (targetSocket) {
      targetSocket.isForceMuted = Boolean(isMuted);
      targetSocket.isMuted = Boolean(isMuted);

      io.to(targetSocket.socketId).emit('admin:force-muted', { isMuted: Boolean(isMuted) });
      io.emit('users:updated', Object.values(users));
      io.emit('voice:rooms-updated', getVoiceRoomsData());
      console.log(`[Admin] ${caller.username} kullanıcısı ${targetSocket.username} için susturma durumunu değiştirdi: ${isMuted}`);
    }
  });

  // 3. Hesabı Pasife Çekme (Admin Deactivate)
  socket.on('admin:deactivate', ({ targetUserId }) => {
    const caller = users[socket.id];
    if (!caller || !caller.isAdmin) return;

    const targetSocket = Object.values(users).find(u => u.id === targetUserId);
    if (targetSocket) {
      targetSocket.isPassive = true;
      if (targetSocket.currentVoiceRoom && voiceRooms[targetSocket.currentVoiceRoom]) {
        voiceRooms[targetSocket.currentVoiceRoom].delete(targetSocket.socketId);
      }
      io.to(targetSocket.socketId).emit('admin:deactivated', {
        message: 'Hesabınız yönetici tarafından pasife alınmıştır.'
      });
      io.emit('voice:rooms-updated', getVoiceRoomsData());
      io.emit('users:updated', Object.values(users));
      console.log(`[Admin] ${caller.username} kullanıcısı ${targetSocket.username} hesabını pasife aldı.`);
    }
  });

  // Instant friend request relay
  socket.on('friend:request', ({ toUserCode, toUsername, fromUser }) => {
    const target = Object.values(users).find(
      u => (toUserCode && u.user_code === toUserCode) || (toUsername && u.username.toLowerCase() === toUsername.toLowerCase())
    );
    if (target) {
      const targetSocketId = target.socketId || target.id;
      io.to(targetSocketId).emit('friend:request-received', { fromUser });
    }
  });

  // Friend response / accept relay
  socket.on('friend:respond', ({ toUserCode, toUsername, fromUser, accepted }) => {
    const target = Object.values(users).find(
      u => (toUserCode && u.user_code === toUserCode) || (toUsername && u.username.toLowerCase() === toUsername.toLowerCase())
    );
    if (target) {
      const targetSocketId = target.socketId || target.id;
      io.to(targetSocketId).emit('friend:respond-received', { fromUser, accepted });
    }
  });

  // Text message
  socket.on('chat:message', ({ channelId, text }) => {
    const user = users[socket.id];
    if (!user || !text || !text.trim()) return;

    if (!channelMessages[channelId]) {
      channelMessages[channelId] = [];
    }

    const newMsg = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      channelId,
      sender: {
        id: user.id,
        username: user.username,
        avatar: user.avatar
      },
      text: text.trim(),
      timestamp: new Date().toISOString()
    };

    // Keep last 100 messages per channel
    channelMessages[channelId].push(newMsg);
    if (channelMessages[channelId].length > 100) {
      channelMessages[channelId].shift();
    }

    io.emit('chat:message', newMsg);
  });

  // Dynamic room creation
  socket.on('room:create', ({ id, name, limit, created_by }) => {
    const user = users[socket.id];
    if (!name || !name.trim()) return;

    const roomId = id || `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newRoom = {
      id: roomId,
      name: name.trim(),
      limit: parseInt(limit, 10) || 5,
      created_by: created_by || (user ? user.id : null),
      creator: user ? user.username : 'Oyuncu'
    };

    const existingIdx = channels.voice.findIndex(v => v.id === roomId);
    if (existingIdx >= 0) {
      channels.voice[existingIdx] = newRoom;
    } else {
      channels.voice.push(newRoom);
    }

    if (!voiceRooms[roomId]) {
      voiceRooms[roomId] = new Set();
    }

    io.emit('channels:updated', channels);
    io.emit('voice:rooms-updated', getVoiceRoomsData());

    socket.emit('room:created', newRoom);
  });

  // Dynamic room edit
  socket.on('room:updated', (updatedRoom) => {
    if (!updatedRoom || !updatedRoom.id) return;
    const idx = channels.voice.findIndex(v => v.id === updatedRoom.id);
    if (idx >= 0) {
      channels.voice[idx] = { ...channels.voice[idx], ...updatedRoom };
    } else {
      channels.voice.push(updatedRoom);
    }
    io.emit('channels:updated', channels);
  });

  // Dynamic room delete
  socket.on('room:deleted', ({ id }) => {
    if (!id) return;
    channels.voice = channels.voice.filter(v => v.id !== id);
    if (voiceRooms[id]) {
      for (const socketId of voiceRooms[id]) {
        const u = users[socketId];
        if (u) u.currentVoiceRoom = null;
      }
      delete voiceRooms[id];
    }
    io.emit('channels:updated', channels);
    io.emit('voice:rooms-updated', getVoiceRoomsData());
  });

  // Voice room join
  socket.on('voice:join', ({ roomId }) => {
    const user = users[socket.id];
    if (!user) return;

    // Leave previous voice room if in one
    if (user.currentVoiceRoom && voiceRooms[user.currentVoiceRoom]) {
      leaveVoiceRoom(socket, user.currentVoiceRoom);
    }

    if (!voiceRooms[roomId]) {
      voiceRooms[roomId] = new Set();
    }

    // Get list of existing peers in this voice room before adding new one
    const existingPeers = Array.from(voiceRooms[roomId]);

    voiceRooms[roomId].add(socket.id);
    user.currentVoiceRoom = roomId;

    socket.join(roomId);

    // Send existing peers to the newly joined peer so it can initiate WebRTC offers
    socket.emit('voice:peers', {
      roomId,
      peers: existingPeers.map(peerId => ({
        id: peerId,
        user: users[peerId]
      }))
    });

    // Notify other peers in the room that a new user joined
    socket.to(roomId).emit('voice:user-joined', {
      roomId,
      peer: {
        id: socket.id,
        user
      }
    });

    io.emit('voice:rooms-updated', getVoiceRoomsData());
    io.emit('users:updated', Object.values(users));
  });

  // Voice room leave
  socket.on('voice:leave', () => {
    const user = users[socket.id];
    if (user && user.currentVoiceRoom) {
      leaveVoiceRoom(socket, user.currentVoiceRoom);
      io.emit('voice:rooms-updated', getVoiceRoomsData());
      io.emit('users:updated', Object.values(users));
    }
  });

  // WebRTC Signaling: Offer
  socket.on('webrtc:offer', ({ to, offer }) => {
    io.to(to).emit('webrtc:offer', {
      from: socket.id,
      offer
    });
  });

  // WebRTC Signaling: Answer
  socket.on('webrtc:answer', ({ to, answer }) => {
    io.to(to).emit('webrtc:answer', {
      from: socket.id,
      answer
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('webrtc:ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('webrtc:ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Voice state updates (mute, deafen, speaking, screen sharing)
  socket.on('voice:state', (state) => {
    const user = users[socket.id];
    if (!user) return;

    Object.assign(user, state);

    if (user.currentVoiceRoom) {
      io.to(user.currentVoiceRoom).emit('voice:peer-state-changed', {
        peerId: socket.id,
        state
      });
    }

    io.emit('users:updated', Object.values(users));
  });

  // Speaking indicator (VAD audio level triggered by client analyser)
  socket.on('voice:speaking', ({ isSpeaking }) => {
    const user = users[socket.id];
    if (user && user.currentVoiceRoom) {
      socket.to(user.currentVoiceRoom).emit('voice:peer-speaking', {
        peerId: socket.id,
        isSpeaking
      });
    }
  });

  // Screen share signal toggle
  socket.on('voice:screenshare-toggle', ({ isSharing }) => {
    const user = users[socket.id];
    if (user) {
      user.isScreenSharing = isSharing;
      if (user.currentVoiceRoom) {
        io.to(user.currentVoiceRoom).emit('voice:screenshare-updated', {
          peerId: socket.id,
          isSharing
        });
      }
      io.emit('users:updated', Object.values(users));
    }
  });

  // Disconnect cleanup
  socket.on('disconnect', () => {
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
    const user = users[socket.id];
    if (user && user.currentVoiceRoom) {
      leaveVoiceRoom(socket, user.currentVoiceRoom);
    }
    delete users[socket.id];
    io.emit('users:updated', Object.values(users));
    io.emit('voice:rooms-updated', getVoiceRoomsData());
  });

  function leaveVoiceRoom(sock, roomId) {
    if (voiceRooms[roomId]) {
      voiceRooms[roomId].delete(sock.id);
      sock.leave(roomId);
      sock.to(roomId).emit('voice:user-left', {
        roomId,
        peerId: sock.id
      });
    }
    if (users[sock.id]) {
      users[sock.id].currentVoiceRoom = null;
      users[sock.id].isScreenSharing = false;
    }
  }

  function getVoiceRoomsData() {
    const data = {};
    for (const [rId, socketSet] of Object.entries(voiceRooms)) {
      data[rId] = Array.from(socketSet).map(sId => users[sId]).filter(Boolean);
    }
    return data;
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 TurkCord Signaling & Chat Server running on http://localhost:${PORT}`);
});
