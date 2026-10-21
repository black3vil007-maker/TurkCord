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
    this.onRoomUpdated = null; // (room) => void
    this.onRoomDeleted = null; // (roomId) => void
    this.currentVoiceRoom = null;
    this.isMuted = false;
    this.isDeafened = false;
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
      if (payload && payload.to === this.currentUser?.id) {
        if (this.onOffer) this.onOffer(payload.from, payload.offer);
      }
    });

    this.channel.on('broadcast', { event: 'webrtc:answer' }, ({ payload }) => {
      if (payload && payload.to === this.currentUser?.id) {
        if (this.onAnswer) this.onAnswer(payload.from, payload.answer);
      }
    });

    this.channel.on('broadcast', { event: 'webrtc:ice-candidate' }, ({ payload }) => {
      if (payload && payload.to === this.currentUser?.id) {
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
  }

  handlePresenceSync() {
    if (!this.channel) return;
    const state = this.channel.presenceState();
    const rooms = {};
    const onlineMap = new Map();

    Object.values(state).forEach(presences => {
      presences.forEach(user => {
        if (!user || !user.id) return;
        onlineMap.set(user.id, user);

        if (user.currentVoiceRoom) {
          if (!rooms[user.currentVoiceRoom]) {
            rooms[user.currentVoiceRoom] = [];
          }
          if (!rooms[user.currentVoiceRoom].some(u => u.id === user.id)) {
            rooms[user.currentVoiceRoom].push(user);
          }
        }
      });
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

  destroy() {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

export const realtimeSignaling = new RealtimeSignaling();
