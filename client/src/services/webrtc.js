import { socket } from './socket';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

class WebRTCManager {
  constructor() {
    this.localStream = null;
    this.screenStream = null;
    this.peers = {}; // { [peerId]: { connection: RTCPeerConnection, remoteStream: MediaStream, audioEl: HTMLAudioElement } }
    this.audioContext = null;
    this.analyser = null;
    this.vadInterval = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.onPeersChange = null;
    this.onSpeakingChange = null;
  }

  // Initialize local microphone
  async initLocalAudio() {
    if (this.localStream) return this.localStream;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: false
      });

      this.setupVAD(this.localStream);
      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] Microphone access error:', err);
      throw err;
    }
  }

  // Voice Activity Detection (Detect when user is speaking to light up green indicator)
  setupVAD(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.4;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let wasSpeaking = false;

      this.vadInterval = setInterval(() => {
        if (this.isMuted || !this.localStream) {
          if (wasSpeaking) {
            wasSpeaking = false;
            if (this.onSpeakingChange) this.onSpeakingChange(socket.id, false);
            socket.emit('voice:speaking', { isSpeaking: false });
          }
          return;
        }

        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const isSpeaking = average > 18; // Sensible threshold for voice

        if (isSpeaking !== wasSpeaking) {
          wasSpeaking = isSpeaking;
          if (this.onSpeakingChange) this.onSpeakingChange(socket.id, isSpeaking);
          socket.emit('voice:speaking', { isSpeaking });
        }
      }, 100);
    } catch (e) {
      console.warn('[WebRTC] VAD setup failed:', e);
    }
  }

  // Connect to an existing peer (Caller initiates offer)
  async createPeerConnection(peerId, isInitiator) {
    if (this.peers[peerId]) {
      return this.peers[peerId].connection;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const remoteStream = new MediaStream();

    // Create an audio element for remote audio playback
    const audioEl = new Audio();
    audioEl.autoplay = true;
    audioEl.muted = this.isDeafened;
    audioEl.srcObject = remoteStream;

    this.peers[peerId] = {
      connection: pc,
      remoteStream,
      audioEl,
      user: null
    };

    // Add local mic tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Add screen share tracks if currently sharing
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        pc.addTrack(track, this.screenStream);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
      if (this.onPeersChange) this.onPeersChange({ ...this.peers });
    };

    // Send ICE candidates to remote peer via socket
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice-candidate', {
          to: peerId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.closePeer(peerId);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { to: peerId, offer });
      } catch (err) {
        console.error('[WebRTC] Error creating offer to ' + peerId, err);
      }
    }

    if (this.onPeersChange) this.onPeersChange({ ...this.peers });
    return pc;
  }

  // Handle incoming Offer from a peer
  async handleOffer(peerId, offer) {
    let peer = this.peers[peerId];
    let pc;
    if (!peer) {
      pc = await this.createPeerConnection(peerId, false);
    } else {
      pc = peer.connection;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit('webrtc:answer', {
      to: peerId,
      answer
    });
  }

  // Handle incoming Answer
  async handleAnswer(peerId, answer) {
    const peer = this.peers[peerId];
    if (peer && peer.connection) {
      await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  // Handle incoming ICE candidate
  async handleCandidate(peerId, candidate) {
    const peer = this.peers[peerId];
    if (peer && peer.connection && peer.connection.remoteDescription) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Error adding ice candidate:', e);
      }
    }
  }

  // Screen sharing toggle
  async startScreenShare() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 30, max: 60 }
        },
        audio: true
      });

      const videoTrack = this.screenStream.getVideoTracks()[0];

      // Add track to all connected peers
      for (const [peerId, peer] of Object.entries(this.peers)) {
        const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        } else {
          peer.connection.addTrack(videoTrack, this.screenStream);
          // Renogotiate
          this.renegotiate(peerId, peer.connection);
        }
      }

      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      socket.emit('voice:screenshare-toggle', { isSharing: true });
      return this.screenStream;
    } catch (err) {
      console.warn('[WebRTC] Screen share cancelled or failed:', err);
      return null;
    }
  }

  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;

      // Remove video track from peers
      for (const [peerId, peer] of Object.entries(this.peers)) {
        const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          peer.connection.removeTrack(sender);
          this.renegotiate(peerId, peer.connection);
        }
      }

      socket.emit('voice:screenshare-toggle', { isSharing: false });
      if (this.onPeersChange) this.onPeersChange({ ...this.peers });
    }
  }

  async renegotiate(peerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { to: peerId, offer });
    } catch (e) {
      console.error('[WebRTC] Renegotiation error:', e);
    }
  }

  // Toggle Mute Microphone
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    socket.emit('voice:state', { isMuted: this.isMuted });
    return this.isMuted;
  }

  // Toggle Deafen (Mutes incoming audio and self microphone)
  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    
    // If deafened, also auto-mute microphone like Discord
    if (this.isDeafened && !this.isMuted) {
      this.toggleMute();
    } else if (!this.isDeafened && this.isMuted) {
      this.toggleMute();
    }

    // Mute/unmute all peer audio elements
    for (const peer of Object.values(this.peers)) {
      if (peer.audioEl) {
        peer.audioEl.muted = this.isDeafened;
      }
    }

    socket.emit('voice:state', { isDeafened: this.isDeafened, isMuted: this.isMuted });
    return this.isDeafened;
  }

  // Close specific peer
  closePeer(peerId) {
    const peer = this.peers[peerId];
    if (peer) {
      if (peer.audioEl) {
        peer.audioEl.srcObject = null;
        peer.audioEl.remove();
      }
      if (peer.connection) {
        peer.connection.close();
      }
      delete this.peers[peerId];
      if (this.onPeersChange) this.onPeersChange({ ...this.peers });
    }
  }

  // Leave voice room completely
  leaveRoom() {
    this.stopScreenShare();

    for (const peerId of Object.keys(this.peers)) {
      this.closePeer(peerId);
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    socket.emit('voice:leave');
    if (this.onPeersChange) this.onPeersChange({});
  }

  // Get real-time WebRTC round-trip time (Ping / latency) from active RTC connections
  async getAveragePing() {
    const peerList = Object.values(this.peers);
    if (peerList.length === 0) return null;

    let totalRtt = 0;
    let count = 0;

    for (const peer of peerList) {
      if (!peer.connection) continue;
      try {
        const stats = await peer.connection.getStats();
        stats.forEach((report) => {
          if (
            report.type === 'candidate-pair' &&
            report.state === 'succeeded' &&
            report.currentRoundTripTime !== undefined
          ) {
            totalRtt += report.currentRoundTripTime * 1000; // to ms
            count++;
          }
        });
      } catch (e) {}
    }

    if (count > 0) {
      return Math.round(totalRtt / count);
    }
    return 14; // Typical local / fast LAN default
  }

  // Self Mic Loopback Test (Hear your own voice + meter)
  async startMicTest(onLevel) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const testCtx = new AudioCtx();
      const source = testCtx.createMediaStreamSource(stream);
      const analyser = testCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      // Connect to speakers so user can hear themselves
      const gainNode = testCtx.createGain();
      gainNode.gain.value = 0.9;
      source.connect(gainNode);
      gainNode.connect(testCtx.destination);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const volume = Math.min(100, Math.round((sum / bufferLength) * 2));
        if (onLevel) onLevel(volume);
      }, 50);

      this._testCleanUp = () => {
        clearInterval(interval);
        gainNode.disconnect();
        source.disconnect();
        testCtx.close();
        stream.getTracks().forEach(t => t.stop());
      };

      return true;
    } catch (e) {
      console.error('[WebRTC] Mic test error:', e);
      return false;
    }
  }

  stopMicTest() {
    if (this._testCleanUp) {
      this._testCleanUp();
      this._testCleanUp = null;
    }
  }
}

export const webrtc = new WebRTCManager();
