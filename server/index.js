import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    { 
      id: 'turkcord-updates', 
      name: 'turkcord-güncellemeler', 
      description: '📢 Resmi TurkCord yenilikleri, sürüm notları ve duyuruları',
      isAnnouncement: true 
    },
    { id: 'genel', name: 'genel-sohbet', description: 'Herkesin sohbet edebileceği ana kanal' },
    { id: 'oyunlar', name: 'oyun-tavsiyeleri', description: 'Oyun linkleri, taktikler ve sohbet' }
  ],
  voice: [
    { id: 'voice-lobi', name: 'Lobi', limit: 10 },
    { id: 'voice-oyun-1', name: 'Oyun Odası #1 (Squad)', limit: 5 },
    { id: 'voice-oyun-2', name: 'Oyun Odası #2 (Duo)', limit: 2 },
    { id: 'voice-muhabbet', name: 'Sessiz / Chill', limit: 8 }
  ]
};

// In-memory & disk-persistent text messages: { [channelId]: [ { id, sender, text, timestamp, avatar } ] }
const MESSAGES_FILE = path.join(__dirname, 'messages_store.json');

let channelMessages = {
  'turkcord-updates': [],
  'genel': [
    {
      id: 'welcome-msg',
      sender: { id: 'system', username: 'TurkCord Bot', avatar: '🤖', isAdmin: true },
      text: 'TurkCord sunucusuna hoş geldiniz! Sol menüden ses odalarına katılabilir ve arkadaşlarınızla sıfır gecikmeli sesli/görüntülü sohbet edebilirsiniz.',
      timestamp: new Date().toISOString()
    }
  ],
  'oyunlar': []
};

// Diskten kalıcı sohbet ve güncelleme loglarını yükle
try {
  if (fs.existsSync(MESSAGES_FILE)) {
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      channelMessages = { ...channelMessages, ...parsed };
      console.log('[Server] Loaded persistent chat and update messages from disk');
    }
  }
} catch (err) {
  console.warn('[Server] Error loading messages_store.json:', err);
}

function saveMessagesToDisk() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(channelMessages, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Server] Error saving messages_store.json:', err);
  }
}

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
    let finalUsername = username.trim();
    if (['admin', 'administrator', 'yönetici'].includes(finalUsername.toLowerCase()) && !isAdmin) {
      finalUsername = 'Kullanıcı_' + (user_code || id.slice(0, 4));
    }

    users[socket.id] = {
      socketId: socket.id,
      id: id,
      email: email || null,
      isAdmin: isAdmin,
      isPassive: false,
      username: finalUsername,
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
  socket.on('chat:message', ({ channelId, text, image, id }) => {
    const user = users[socket.id];
    if (!user || (!text && !image)) return;

    if (!channelMessages[channelId]) {
      channelMessages[channelId] = [];
    }

    const msgId = id || `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Server-side duplicate check by ID or rapid identical message
    const isDup = channelMessages[channelId].some(m => 
      m.id === msgId || 
      (m.sender?.id === user.id && m.text === (text || '').trim() && m.image === (image || null) && (Date.now() - new Date(m.timestamp).getTime() < 3000))
    );
    if (isDup) return;

    const newMsg = {
      id: msgId,
      channelId,
      sender: {
        id: user.id,
        username: user.username,
        avatar: user.avatar
      },
      text: (text || '').trim(),
      image: image || null,
      timestamp: new Date().toISOString()
    };

    // Keep persistent message log (up to 1000 messages for changelog / history)
    channelMessages[channelId].push(newMsg);
    if (channelMessages[channelId].length > 1000) {
      channelMessages[channelId].shift();
    }
    saveMessagesToDisk();

    io.emit('chat:message', newMsg);
  });

  // Chat message delete (Allows admin or sender to delete an update/message)
  socket.on('chat:delete', ({ channelId, messageId }) => {
    if (!channelId || !messageId || !channelMessages[channelId]) return;
    const user = users[socket.id];
    const idx = channelMessages[channelId].findIndex(m => m.id === messageId);
    if (idx !== -1) {
      const msg = channelMessages[channelId][idx];
      // Allow if admin or message author
      const isAuthor = msg.sender && (msg.sender.id === user?.id || String(msg.sender.id) === String(user?.id));
      if (!user || user.isAdmin || isAuthor) {
        channelMessages[channelId].splice(idx, 1);
        saveMessagesToDisk();
        io.emit('chat:message-deleted', { channelId, messageId });
      }
    }
  });

  // Chat clear relay
  socket.on('chat:clear', ({ channelId }) => {
    if (!channelId) return;
    channelMessages[channelId] = [];
    saveMessagesToDisk();
    io.emit('chat:clear', { channelId });
  });

  // Dynamic text channel create
  socket.on('textchannel:create', ({ id, name, description, created_by }) => {
    if (!name || !name.trim()) return;
    const channelId = id || `text-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newChan = {
      id: channelId,
      name: name.trim().toLowerCase().replace(/\s+/g, '-'),
      description: description || '',
      created_by: created_by || null
    };

    if (!channels.text.some(c => c.id === channelId)) {
      channels.text.push(newChan);
    }
    io.emit('channels:updated', channels);
  });

  // Dynamic text channel delete
  socket.on('textchannel:delete', ({ id }) => {
    if (!id || id === 'genel') return;
    channels.text = channels.text.filter(c => c.id !== id);
    delete channelMessages[id];
    io.emit('channels:updated', channels);
    io.emit('textchannel:deleted', { id });
  });

  // Dynamic room creation (Preserves password protection for rooms)
  socket.on('room:create', (roomData) => {
    const user = users[socket.id];
    if (!roomData || !roomData.name || !roomData.name.trim()) return;

    const roomId = roomData.id || `room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const rawPwd = roomData.password ? String(roomData.password).trim() : null;
    const isProtected = Boolean(roomData.hasPassword || (rawPwd && rawPwd.length > 0));

    const newRoom = {
      id: roomId,
      name: roomData.name.trim(),
      limit: parseInt(roomData.limit || roomData.limit_count, 10) || 5,
      created_by: roomData.created_by || (user ? user.id : null),
      creator: user ? user.username : 'Oyuncu',
      hasPassword: isProtected,
      password: isProtected ? rawPwd : null
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

  // Dynamic room edit (Preserves password protection)
  socket.on('room:updated', (updatedRoom) => {
    if (!updatedRoom || !updatedRoom.id) return;
    const rawPwd = updatedRoom.password ? String(updatedRoom.password).trim() : null;
    const isProtected = Boolean(updatedRoom.hasPassword || (rawPwd && rawPwd.length > 0));
    const roomObj = {
      ...updatedRoom,
      hasPassword: isProtected,
      password: isProtected ? rawPwd : null
    };

    const idx = channels.voice.findIndex(v => v.id === updatedRoom.id);
    if (idx >= 0) {
      channels.voice[idx] = { ...channels.voice[idx], ...roomObj };
    } else {
      channels.voice.push(roomObj);
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

  // Dynamic channel reordering (Admin or User room order updates)
  socket.on('channels:reorder', ({ type, orderedIds }) => {
    if (!type || !Array.isArray(orderedIds)) return;
    if (type === 'voice' && channels.voice) {
      const map = new Map(channels.voice.map(v => [v.id, v]));
      const newVoice = [];
      orderedIds.forEach(id => {
        if (map.has(id)) {
          newVoice.push(map.get(id));
          map.delete(id);
        }
      });
      map.forEach(v => newVoice.push(v));
      channels.voice = newVoice;
      io.emit('channels:updated', channels);
    } else if (type === 'text' && channels.text) {
      const map = new Map(channels.text.map(t => [t.id, t]));
      const newText = [];
      orderedIds.forEach(id => {
        if (map.has(id)) {
          newText.push(map.get(id));
          map.delete(id);
        }
      });
      map.forEach(t => newText.push(t));
      channels.text = newText;
      io.emit('channels:updated', channels);
    }
  });

  // Voice room join with strict single-room occupancy per user across all sessions/devices
  socket.on('voice:join', ({ roomId, user: clientUser }) => {
    let user = users[socket.id];
    if (!user && clientUser) {
      users[socket.id] = {
        socketId: socket.id,
        id: clientUser.id,
        username: clientUser.username || 'Kullanıcı',
        avatar: clientUser.avatar || '🎮',
        user_code: clientUser.user_code || null,
        currentVoiceRoom: null,
        isMuted: false,
        isDeafened: false,
        isScreenSharing: false,
        isForceMuted: false
      };
      user = users[socket.id];
    }
    if (!user) return;

    // 1. Leave previous room if in one on this socket
    if (user.currentVoiceRoom) {
      leaveVoiceRoom(socket, user.currentVoiceRoom);
    }

    // 2. Clear any OTHER sockets belonging to this user across all sessions/devices
    for (const [sId, u] of Object.entries(users)) {
      if (u && u.id === user.id && sId !== socket.id) {
        if (u.currentVoiceRoom) {
          const oldRoom = u.currentVoiceRoom;
          const otherSock = io.sockets.sockets.get(sId);
          if (otherSock) {
            leaveVoiceRoom(otherSock, oldRoom);
            otherSock.emit('voice:force-leave', {
              reason: 'Hesabınız başka bir cihazdan ses odasına bağlandı.'
            });
          } else if (voiceRooms[oldRoom]) {
            voiceRooms[oldRoom].delete(sId);
            io.to(oldRoom).emit('voice:user-left', { roomId: oldRoom, peerId: sId });
          }
        }
        u.currentVoiceRoom = null;
      }
    }

    // 3. Remove user's sockets from all other rooms
    for (const [rId, socketSet] of Object.entries(voiceRooms)) {
      if (rId !== roomId) {
        for (const sId of Array.from(socketSet)) {
          if (users[sId]?.id === user.id) {
            socketSet.delete(sId);
            io.to(rId).emit('voice:user-left', { roomId: rId, peerId: sId });
          }
        }
      }
    }

    // 4. Add to target room
    if (!voiceRooms[roomId]) {
      voiceRooms[roomId] = new Set();
    }
    const existingPeers = Array.from(voiceRooms[roomId]).filter(sId => sId !== socket.id);

    voiceRooms[roomId].add(socket.id);
    user.currentVoiceRoom = roomId;

    socket.join(roomId);

    function resolveTargetSocketId(targetId) {
      if (!targetId) return null;
      if (users[targetId]) return targetId;
      const found = Object.values(users).find(u => u.id === targetId || u.socketId === targetId);
      return found ? found.socketId : null;
    }

    // 5. Send peers and broadcast updates
    socket.emit('voice:peers', {
      roomId,
      peers: existingPeers.map(peerId => ({
        id: users[peerId]?.id || peerId,
        socketId: peerId,
        user: users[peerId]
      }))
    });

    socket.to(roomId).emit('voice:user-joined', {
      roomId,
      peer: {
        id: user.id || socket.id,
        socketId: socket.id,
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

  // WebRTC Signaling: Offer (Supports both userId and socketId)
  socket.on('webrtc:offer', ({ to, offer }) => {
    const user = users[socket.id];
    const fromId = user?.id || socket.id;
    const targetSocketId = resolveTargetSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:offer', {
        from: fromId,
        offer
      });
    }
  });

  // WebRTC Signaling: Answer (Supports both userId and socketId)
  socket.on('webrtc:answer', ({ to, answer }) => {
    const user = users[socket.id];
    const fromId = user?.id || socket.id;
    const targetSocketId = resolveTargetSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:answer', {
        from: fromId,
        answer
      });
    }
  });

  // WebRTC Signaling: ICE Candidate (Supports both userId and socketId)
  socket.on('webrtc:ice-candidate', ({ to, candidate }) => {
    const user = users[socket.id];
    const fromId = user?.id || socket.id;
    const targetSocketId = resolveTargetSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:ice-candidate', {
        from: fromId,
        candidate
      });
    }
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
        peerId: users[sock.id]?.id || sock.id,
        socketId: sock.id
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
