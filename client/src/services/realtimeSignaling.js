import { supabase } from './supabase';

class RealtimeSignaling {
  constructor() {
    this.channel = null;
    this.currentUser = null;
    this.onPresenceChange = null; // (rooms, allUsers) => void
    this.onOffer = null; // (fromId, offer) => void
    this.onAnswer = null; // (fromId, answer) => void
    this.onCandidate = null; // (fromId, candidate) => void
    this.onSpeaking = null; // (fromId, isSpeaking) => void
    this.onChatMessage = null; // (message) => void
    this.onChatDelete = null; // (channelId, messageId) => void
    this.onChatClear = null; // (channelId) => void
    this.onRoomUpdated = null; // (room) => void
    this.onRoomDeleted = null; // (roomId) => void
    this.onTextChannelUpdated = null; // (channel) => void
    this.onTextChannelDeleted = null; // (channelId) => void
    this.onScreenShareToggle = null; // (userId, isSharing) => void
    this.onQualityRequest = null; // (fromId, quality) => void
    this.currentVoiceRoom = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.presenceQueue = Promise.resolve();
  }

  init(user) {
    if (!user?.id) return;
    this.currentUser = user;

    if (this.channel) {
      supabase.removeChannel(this.channel);
    }

    this.channel = supabase.channel('turkcord:global', {
      config: {
        presence: { key: user.id },
        broadcast: { ack: false }
      }
    });

    // 1. Presence Sync (tracks who is online and who is in which voice room)
    this.channel.on('presence', { event: 'sync' }, () => {
      this.handlePresenceSync();
    });

    // 2. Broadcast events for WebRTC signaling
    this.channel.on('broadcast', { event: 'webrtc:offer' }, ({ payload }) => {
      if (payload && String(payload.to) === String(this.currentUser?.id)) {
        if (this.onOffer) this.onOffer(payload.from, payload.offer);
      }
    });

    this.channel.on('broadcast', { event: 'webrtc:answer' }, ({ payload }) => {
      if (payload && String(payload.to) === String(this.currentUser?.id)) {
        if (this.onAnswer) this.onAnswer(payload.from, payload.answer);
      }
    });

    this.channel.on('broadcast', { event: 'webrtc:ice-candidate' }, ({ payload }) => {
      if (payload && String(payload.to) === String(this.currentUser?.id)) {
        if (this.onCandidate) this.onCandidate(payload.from, payload.candidate);
      }
    });

    this.channel.on('broadcast', { event: 'voice:speaking' }, ({ payload }) => {
      if (payload && this.onSpeaking) {
        this.onSpeaking(payload.from, payload.isSpeaking);
      }
    });

    this.channel.on('broadcast', { event: 'chat:message' }, ({ payload }) => {
      if (payload && this.onChatMessage) {
        this.onChatMessage(payload);
      }
    });

    this.channel.on('broadcast', { event: 'chat:delete' }, ({ payload }) => {
      if (payload && this.onChatDelete) {
        this.onChatDelete(payload.channelId, payload.messageId);
      }
    });

    this.channel.on('broadcast', { event: 'chat:clear' }, ({ payload }) => {
      if (payload && this.onChatClear) {
        this.onChatClear(payload.channelId);
      }
    });

    this.channel.on('broadcast', { event: 'room:updated' }, ({ payload }) => {
      if (payload && this.onRoomUpdated) {
        this.onRoomUpdated(payload);
      }
    });

    this.channel.on('broadcast', { event: 'room:deleted' }, ({ payload }) => {
      if (payload && this.onRoomDeleted) {
        this.onRoomDeleted(payload.id);
      }
    });

    this.channel.on('broadcast', { event: 'textchannel:updated' }, ({ payload }) => {
      if (payload && this.onTextChannelUpdated) {
        this.onTextChannelUpdated(payload);
      }
    });

    this.channel.on('broadcast', { event: 'textchannel:deleted' }, ({ payload }) => {
      if (payload && this.onTextChannelDeleted) {
        this.onTextChannelDeleted(payload.id);
      }
    });

    this.channel.on('broadcast', { event: 'screenshare:toggle' }, ({ payload }) => {
      if (payload && this.onScreenShareToggle) {
        this.onScreenShareToggle(payload.userId, payload.isSharing);
      }
    });

    this.channel.on('broadcast', { event: 'screenshare:set-quality' }, ({ payload }) => {
      if (payload && payload.to === this.currentUser?.id && this.onQualityRequest) {
        this.onQualityRequest(payload.from, payload.quality);
      }
    });

    this.channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await this.syncPresence();
      }
    });
  }

  async setVoiceRoom(roomId) {
    this.currentVoiceRoom = roomId;
    await this.syncPresence();
  }

  async setAudioState(isMuted, isDeafened) {
    this.isMuted = isMuted;
    this.isDeafened = isDeafened;
    await this.syncPresence();
  }

  async syncPresence() {
    if (!this.channel || !this.currentUser?.id) return;
    this.presenceQueue = this.presenceQueue.then(async () => {
      if (!this.channel || !this.currentUser?.id) return;
      try {
        await this.channel.track({
          id: this.currentUser.id,
          username: this.currentUser.username,
          avatar: this.currentUser.avatar,
          user_code: this.currentUser.user_code,
          currentVoiceRoom: this.currentVoiceRoom,
          isMuted: this.isMuted,
          isDeafened: this.isDeafened
        });
      } catch (err) {
        console.warn('[RealtimeSignaling] Track error:', err);
      }
    });
    return this.presenceQueue;
  }

  handlePresenceSync() {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    const rooms = {};
    const onlineMap = new Map();
    const userVoiceRoomMap = new Map();

    Object.values(state).forEach(presences => {
      presences.forEach(user => {
        if (!user || !user.id) return;
        const existing = onlineMap.get(user.id);
        if (!existing || (!existing.currentVoiceRoom && user.currentVoiceRoom)) {
          onlineMap.set(user.id, user);
        } else if (!existing) {
          onlineMap.set(user.id, user);
        }

        // A user is in a room if any active presence session of theirs has an active room
        if (user.currentVoiceRoom) {
          userVoiceRoomMap.set(user.id, user.currentVoiceRoom);
        }
      });
    });

    // Enforce strict single-room occupancy per user in Supabase Presence
    userVoiceRoomMap.forEach((roomId, userId) => {
      if (!roomId) return;
      const userObj = onlineMap.get(userId);
      if (!userObj) return;
      if (!rooms[roomId]) {
        rooms[roomId] = [];
      }
      rooms[roomId].push(userObj);
    });

    if (this.onPresenceChange) {
      this.onPresenceChange(rooms, Array.from(onlineMap.values()));
    }
  }

  sendOffer(toUserId, offer) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'webrtc:offer',
      payload: { to: toUserId, from: this.currentUser.id, offer }
    });
  }

  sendAnswer(toUserId, answer) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'webrtc:answer',
      payload: { to: toUserId, from: this.currentUser.id, answer }
    });
  }

  sendCandidate(toUserId, candidate) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'webrtc:ice-candidate',
      payload: { to: toUserId, from: this.currentUser.id, candidate }
    });
  }

  sendSpeaking(isSpeaking) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'voice:speaking',
      payload: { from: this.currentUser.id, isSpeaking }
    });
  }

  sendChatMessage(message) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'chat:message',
      payload: message
    });
  }

  sendChatDelete(channelId, messageId) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'chat:delete',
      payload: { channelId, messageId }
    });
  }

  sendChatClear(channelId) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'chat:clear',
      payload: { channelId }
    });
  }

  sendTextChannelUpdated(channel) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'textchannel:updated',
      payload: channel
    });
  }

  sendTextChannelDeleted(channelId) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'textchannel:deleted',
      payload: { id: channelId }
    });
  }

  sendRoomUpdated(room) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'room:updated',
      payload: room
    });
  }

  sendRoomDeleted(roomId) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'room:deleted',
      payload: { id: roomId }
    });
  }

  sendScreenShareToggle(isSharing) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'screenshare:toggle',
      payload: { userId: this.currentUser.id, isSharing }
    });
  }

  sendQualityRequest(toUserId, quality) {
    if (!this.channel || !this.currentUser) return;
    this.channel.send({
      type: 'broadcast',
      event: 'screenshare:set-quality',
      payload: { to: toUserId, from: this.currentUser.id, quality }
    });
  }

  destroy() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

export const realtimeSignaling = new RealtimeSignaling();
