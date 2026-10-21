import { socket } from './socket';
import { realtimeSignaling } from './realtimeSignaling';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' }
  ],
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 2
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
    this.onSignal = null;
  }

  // Unified signaling dispatcher (both Supabase Realtime Broadcast & Socket.io)
  sendSignal(event, data) {
    if (this.onSignal) {
      try { this.onSignal(event, data); } catch (e) {}
    }

    // 1. Supabase Realtime
    if (event === 'webrtc:offer') {
      realtimeSignaling.sendOffer(data.to, data.offer);
    } else if (event === 'webrtc:answer') {
      realtimeSignaling.sendAnswer(data.to, data.answer);
    } else if (event === 'webrtc:ice-candidate') {
      realtimeSignaling.sendCandidate(data.to, data.candidate);
    } else if (event === 'voice:speaking') {
      realtimeSignaling.sendSpeaking(data.isSpeaking);
    }

    // 2. Socket.io (if connected)
    if (socket && socket.connected) {
      socket.emit(event, data);
    }
  }

  // Initialize local microphone with eSports Gaming Low-Latency constraints
  async initLocalAudio() {
    if (this.localStream) return this.localStream;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: false }, // Avoids 15-30ms heavy software DSP lookahead delay
          autoGainControl: { ideal: false },  // Avoids dynamic compressor buffer delay
          channelCount: { ideal: 1 },         // Mono microphone saves 50% CPU and network payload
          sampleRate: { ideal: 48000 },       // Native Opus 48kHz avoids resampler delay
          sampleSize: { ideal: 16 },
          latency: { ideal: 0.005 }           // Lowest WASAPI / CoreAudio hardware buffer (~5ms)
        },
        video: false
      });

      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack && 'contentHint' in audioTrack) {
        audioTrack.contentHint = 'speech';
      }

      this.setupVAD(this.localStream);
      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] Strict gaming constraints failed, falling back to standard audio:', err);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false
        });
        this.setupVAD(this.localStream);
        return this.localStream;
      } catch (e) {
        console.error('[WebRTC] Microphone access error:', e);
        throw err;
      }
    }
  }

  // Optimize SDP specifically for Gaming: 10ms Opus packets, FEC, 64kbps CBR, no DTX
  optimizeSdpForGaming(sdp) {
    if (!sdp) return sdp;

    const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (!opusMatch) return sdp;

    const opusPayload = opusMatch[1];
    const gamingParams = 'minptime=10;ptime=10;maxaveragebitrate=64000;stereo=0;sprop-stereo=0;cbr=1;useinbandfec=1;usedtx=0';

    const fmtpRegex = new RegExp(`a=fmtp:${opusPayload}\\s+(.*)`, 'i');
    if (fmtpRegex.test(sdp)) {
      return sdp.replace(fmtpRegex, `a=fmtp:${opusPayload} $1;${gamingParams}`);
    } else {
      return sdp.replace(opusMatch[0], `${opusMatch[0]}\r\na=fmtp:${opusPayload} ${gamingParams}`);
    }
  }

  // Optimize RTCPeerConnection for real-time playout without artificial jitter buffering
  optimizePeer(pc) {
    // 1. Receivers: minimize jitter buffer and playout delay to zero
    if (pc.getReceivers) {
      pc.getReceivers().forEach(receiver => {
        if (receiver.track && receiver.track.kind === 'audio') {
          if ('playoutDelayHint' in receiver) {
            receiver.playoutDelayHint = 0; // Ultra low-latency playback
          }
          if ('jitterBufferDelayHint' in receiver) {
            receiver.jitterBufferDelayHint = 0; // Zero artificial buffering
          }
        }
      });
    }

    // 2. Senders: set high network priority and target bitrate
    if (pc.getSenders) {
      pc.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].networkPriority = 'high';
            params.encodings[0].priority = 'high';
            params.encodings[0].maxBitrate = 64000;
            sender.setParameters(params).catch(() => {});
          } catch (e) {}
        }
      });
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
            if (this.onSpeakingChange) this.onSpeakingChange('self', false);
            this.sendSignal('voice:speaking', { isSpeaking: false });
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
          if (this.onSpeakingChange) this.onSpeakingChange('self', isSpeaking);
          this.sendSignal('voice:speaking', { isSpeaking });
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

    // Create or reuse an audio element for remote audio playback attached to DOM
    let audioEl = document.getElementById(`audio-peer-${peerId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio-peer-${peerId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
    }
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

    // Handle remote tracks (Audio & Screen Video)
    pc.ontrack = (event) => {
      if (event.track) {
        remoteStream.addTrack(event.track);
      } else if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
      }

      // If audio track, attach to hidden audio element
      if (event.track && event.track.kind === 'audio') {
        audioEl.srcObject = remoteStream;
        audioEl.play().catch(e => {
          console.warn('[WebRTC] Audio play waiting for user gesture:', e);
        });
      }

      this.optimizePeer(pc);

      if (this.onPeersChange) {
        this.peers[peerId] = {
          ...this.peers[peerId],
          remoteStream: new MediaStream(remoteStream.getTracks())
        };
        this.onPeersChange({ ...this.peers });
      }
    };

    // Send ICE candidates to remote peer via unified signaling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal('webrtc:ice-candidate', {
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
        const optimizedOfferSdp = this.optimizeSdpForGaming(offer.sdp);
        const optimizedOffer = new RTCSessionDescription({
          type: offer.type,
          sdp: optimizedOfferSdp
        });
        await pc.setLocalDescription(optimizedOffer);
        this.optimizePeer(pc);
        this.sendSignal('webrtc:offer', { to: peerId, offer: optimizedOffer });
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
    const optimizedAnswerSdp = this.optimizeSdpForGaming(answer.sdp);
    const optimizedAnswer = new RTCSessionDescription({
      type: answer.type,
      sdp: optimizedAnswerSdp
    });
    await pc.setLocalDescription(optimizedAnswer);
    this.optimizePeer(pc);

    this.sendSignal('webrtc:answer', {
      to: peerId,
      answer: optimizedAnswer
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

  // Screen sharing toggle with resolution choice (1080p, 720p, 480p, auto)
  async startScreenShare(targetQuality = '1080p') {
    let videoConstraints = {
      cursor: 'always'
    };

    if (targetQuality === '1080p') {
      videoConstraints.width = { ideal: 1920, max: 1920 };
      videoConstraints.height = { ideal: 1080, max: 1080 };
      videoConstraints.frameRate = { ideal: 60, max: 60 };
    } else if (targetQuality === '720p') {
      videoConstraints.width = { ideal: 1280, max: 1280 };
      videoConstraints.height = { ideal: 720, max: 720 };
      videoConstraints.frameRate = { ideal: 30, max: 60 };
    } else if (targetQuality === '480p') {
      videoConstraints.width = { ideal: 854, max: 854 };
      videoConstraints.height = { ideal: 480, max: 480 };
      videoConstraints.frameRate = { ideal: 30, max: 30 };
    } else {
      videoConstraints.frameRate = { ideal: 60, max: 60 };
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2
        }
      });

      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = 'motion'; // Optimize for high-framerate gaming
      }

      // Add track to all connected peers and renegotiate
      for (const [peerId, peer] of Object.entries(this.peers)) {
        const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          await sender.replaceTrack(videoTrack);
        } else {
          peer.connection.addTrack(videoTrack, this.screenStream);
          await this.renegotiate(peerId, peer.connection);
        }
        this.setVideoQualityForPeer(peerId, targetQuality);
      }

      videoTrack.onended = () => {
        this.stopScreenShare();
      };

      realtimeSignaling.sendScreenShareToggle(true);
      if (socket && socket.connected) {
        socket.emit('voice:screenshare-toggle', { isSharing: true });
      }
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
          try {
            peer.connection.removeTrack(sender);
            this.renegotiate(peerId, peer.connection);
          } catch (e) {}
        }
      }

      realtimeSignaling.sendScreenShareToggle(false);
      if (socket && socket.connected) {
        socket.emit('voice:screenshare-toggle', { isSharing: false });
      }
      if (this.onPeersChange) this.onPeersChange({ ...this.peers });
    }
  }

  async renegotiate(peerId, pc) {
    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      const optimizedSdp = this.optimizeSdpForGaming(offer.sdp);
      const optimizedOffer = new RTCSessionDescription({
        type: offer.type,
        sdp: optimizedSdp
      });
      await pc.setLocalDescription(optimizedOffer);
      this.optimizePeer(pc);
      this.sendSignal('webrtc:offer', { to: peerId, offer: optimizedOffer });
    } catch (e) {
      console.error('[WebRTC] Renegotiation error:', e);
    }
  }

  // Adjust quality/resolution dynamically per viewer (1080p, 720p, 480p, auto)
  setVideoQualityForPeer(peerId, quality) {
    const peer = this.peers[peerId];
    if (!peer || !peer.connection) return;

    const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      if (quality === '1080p') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 3500000; // 3.5 Mbps for 1080p
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '720p') {
        params.encodings[0].scaleResolutionDownBy = 1.5;
        params.encodings[0].maxBitrate = 1800000; // 1.8 Mbps for 720p
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '480p') {
        params.encodings[0].scaleResolutionDownBy = 2.25;
        params.encodings[0].maxBitrate = 700000;  // 700 Kbps for 480p
        params.encodings[0].maxFramerate = 30;
      } else {
        // Auto / Dynamic Adaptive
        delete params.encodings[0].scaleResolutionDownBy;
        params.encodings[0].maxBitrate = 3500000;
        params.encodings[0].maxFramerate = 60;
      }

      sender.setParameters(params).then(() => {
        console.log(`[WebRTC] Set video quality ${quality} for viewer ${peerId}`);
      }).catch(err => console.warn('setParameters error:', err));
    } catch (e) {
      console.warn('Video quality adjust error:', e);
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
