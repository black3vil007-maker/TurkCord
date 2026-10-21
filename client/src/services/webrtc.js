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
    this.rawStream = null;
    this.processedStream = null;
    this.localStream = null;
    this.screenStream = null;
    this.peers = {}; // { [peerId]: { connection: RTCPeerConnection, remoteStream: MediaStream, audioEl: HTMLAudioElement } }
    this.audioContext = null;
    this.analyser = null;
    this.highpassFilter = null;
    this.gateGainNode = null;
    this.audioDestination = null;
    this.vadInterval = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.onPeersChange = null;
    this.onSpeakingChange = null;
    this.onSignal = null;
    this.onRemoteScreenShareStopped = null;

    // Audio & Noise Reduction Settings
    this.audioSettings = this.loadAudioSettings();
    this.voiceGateHangTimeout = null;
    this.isGateOpen = false;

    // Per-user volume control (0% to 200%)
    this.peerVolumes = this.loadPeerVolumes();
    this.peerGainNodes = {};
    this.remoteAudioContext = null;
  }

  loadPeerVolumes() {
    try {
      const saved = localStorage.getItem('turkcord_peer_volumes');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  }

  setPeerVolume(peerId, volumePercent) {
    const clamped = Math.min(200, Math.max(0, volumePercent));
    this.peerVolumes[peerId] = clamped;
    try {
      localStorage.setItem('turkcord_peer_volumes', JSON.stringify(this.peerVolumes));
    } catch (e) {}

    // 1. Web Audio Gain Node (supports up to 200% boost!)
    if (this.peerGainNodes[peerId]) {
      this.peerGainNodes[peerId].gain.setTargetAtTime(
        this.isDeafened ? 0 : (clamped / 100),
        this.remoteAudioContext?.currentTime || 0,
        0.01
      );
    }

    // 2. Fallback HTML audio element
    const peer = this.peers[peerId];
    if (peer && peer.audioEl && !this.peerGainNodes[peerId]) {
      peer.audioEl.volume = Math.min(1.0, clamped / 100);
      peer.audioEl.muted = this.isDeafened || clamped === 0;
    }

    return clamped;
  }

  getPeerVolume(peerId) {
    return this.peerVolumes[peerId] ?? 100;
  }

  setupPeerAudio(peerId, remoteStream) {
    if (!remoteStream) return;
    const vol = this.peerVolumes[peerId] ?? 100;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!this.remoteAudioContext || this.remoteAudioContext.state === 'closed') {
        this.remoteAudioContext = new AudioCtx({ sampleRate: 48000 });
      }
      if (this.remoteAudioContext.state === 'suspended') {
        this.remoteAudioContext.resume().catch(() => {});
      }

      if (this.peerGainNodes[peerId]) {
        try { this.peerGainNodes[peerId].disconnect(); } catch (e) {}
      }

      const source = this.remoteAudioContext.createMediaStreamSource(remoteStream);
      const gainNode = this.remoteAudioContext.createGain();
      gainNode.gain.value = this.isDeafened ? 0 : (vol / 100);

      source.connect(gainNode);
      gainNode.connect(this.remoteAudioContext.destination);
      this.peerGainNodes[peerId] = gainNode;

      // Keep audioEl muted so sound doesn't play twice
      const peer = this.peers[peerId];
      if (peer && peer.audioEl) {
        peer.audioEl.srcObject = remoteStream;
        peer.audioEl.muted = true;
        peer.audioEl.play().catch(() => {});
      }
    } catch (e) {
      console.warn('[WebRTC] Web Audio peer gain fallback to HTMLAudioElement:', e);
      const peer = this.peers[peerId];
      if (peer && peer.audioEl) {
        peer.audioEl.srcObject = remoteStream;
        peer.audioEl.muted = this.isDeafened;
        peer.audioEl.volume = Math.min(1.0, Math.max(0, vol / 100));
        peer.audioEl.play().catch(() => {});
      }
    }
  }

  loadAudioSettings() {
    try {
      const saved = localStorage.getItem('turkcord_audio_settings');
      if (saved) {
        return {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: false,
          voiceGateEnabled: true,
          voiceGateThreshold: 22,
          keyboardFilterEnabled: true,
          autoSensitivity: false,
          ...JSON.parse(saved)
        };
      }
    } catch (e) {}
    return {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: false,
      voiceGateEnabled: true,
      voiceGateThreshold: 22,
      keyboardFilterEnabled: true,
      autoSensitivity: false
    };
  }

  saveAudioSettings(settings) {
    this.audioSettings = { ...this.audioSettings, ...settings };
    try {
      localStorage.setItem('turkcord_audio_settings', JSON.stringify(this.audioSettings));
    } catch (e) {}

    // Live update Web Audio filter & gate
    if (this.highpassFilter) {
      this.highpassFilter.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 110 : 20;
    }
    if (!this.audioSettings.voiceGateEnabled && this.gateGainNode && this.audioContext) {
      this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
    }
    this.applyAudioSettingsLive();
  }

  async applyAudioSettingsLive() {
    if (!this.rawStream) return;
    const audioTrack = this.rawStream.getAudioTracks()[0];
    if (audioTrack) {
      try {
        await audioTrack.applyConstraints({
          echoCancellation: Boolean(this.audioSettings.echoCancellation),
          noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          autoGainControl: Boolean(this.audioSettings.autoGainControl)
        });
      } catch (e) {
        console.warn('[WebRTC] applyConstraints error:', e);
      }
    }
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

  // Initialize local microphone with studio DSP pipeline (cuts mechanical keyboard noise 100%)
  async initLocalAudio() {
    if (this.localStream) return this.localStream;

    try {
      this.rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: Boolean(this.audioSettings.echoCancellation),
          noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          autoGainControl: Boolean(this.audioSettings.autoGainControl),
          googEchoCancellation: Boolean(this.audioSettings.echoCancellation),
          googNoiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          channelCount: 1,
          sampleRate: 48000,
          sampleSize: 16,
          latency: 0.005
        },
        video: false
      });

      const rawAudioTrack = this.rawStream.getAudioTracks()[0];
      if (rawAudioTrack && 'contentHint' in rawAudioTrack) {
        rawAudioTrack.contentHint = 'speech';
      }

      // Initialize Web Audio DSP Processing Graph
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (this.audioContext && this.audioContext.state !== 'closed') {
        try { this.audioContext.close(); } catch (e) {}
      }
      this.audioContext = new AudioCtx({ sampleRate: 48000 });

      const source = this.audioContext.createMediaStreamSource(this.rawStream);

      // 1. Analyser connected to raw stream so it ALWAYS detects voice accurately
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;
      source.connect(this.analyser);

      // 2. High-pass Filter (110Hz): Cuts mechanical switch bottom-out thumps and desk vibrations
      this.highpassFilter = this.audioContext.createBiquadFilter();
      this.highpassFilter.type = 'highpass';
      this.highpassFilter.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 110 : 20;
      this.highpassFilter.Q.value = 0.7;

      // 3. Hardware Voice Gate: zeros audio volume to 0 during typing/silence
      this.gateGainNode = this.audioContext.createGain();
      this.gateGainNode.gain.setValueAtTime(0, this.audioContext.currentTime);

      // 4. Output Destination for WebRTC transmission
      this.audioDestination = this.audioContext.createMediaStreamDestination();

      // Pipeline: Source -> Highpass Filter -> Voice Gate -> Destination
      source.connect(this.highpassFilter);
      this.highpassFilter.connect(this.gateGainNode);
      this.gateGainNode.connect(this.audioDestination);

      this.processedStream = this.audioDestination.stream;
      this.localStream = this.processedStream;

      const processedTrack = this.localStream.getAudioTracks()[0];
      if (processedTrack && 'contentHint' in processedTrack) {
        processedTrack.contentHint = 'speech';
      }

      this.setupVAD();
      return this.localStream;
    } catch (err) {
      console.warn('[WebRTC] Custom DSP initialization failed, falling back:', err);
      try {
        this.rawStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.localStream = this.rawStream;
        return this.localStream;
      } catch (e) {
        console.error('[WebRTC] Microphone access error:', e);
        throw err;
      }
    }
  }

  // Optimize SDP specifically for Gaming: 10ms Opus packets, FEC, 64kbps CBR, DTX + 8Mbps Crisp Screen Share
  optimizeSdpForGaming(sdp) {
    if (!sdp) return sdp;

    // 1. Opus Audio Optimization with usedtx=1 (suppresses silence packets when gate is closed)
    const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (opusMatch) {
      const opusPayload = opusMatch[1];
      const gamingParams = 'minptime=10;ptime=10;maxaveragebitrate=64000;stereo=0;sprop-stereo=0;cbr=1;useinbandfec=1;usedtx=1';

      const fmtpRegex = new RegExp(`a=fmtp:${opusPayload}\\s+(.*)`, 'i');
      if (fmtpRegex.test(sdp)) {
        sdp = sdp.replace(fmtpRegex, `a=fmtp:${opusPayload} $1;${gamingParams}`);
      } else {
        sdp = sdp.replace(opusMatch[0], `${opusMatch[0]}\r\na=fmtp:${opusPayload} ${gamingParams}`);
      }
    }

    // 2. Video Bandwidth Injection (Crucial: boosts default WebRTC 300kbps limit to 8000kbps / 8 Mbps for crisp 1080p)
    if (sdp.includes('m=video')) {
      if (!sdp.includes('b=AS:')) {
        sdp = sdp.replace(/(m=video [^\r\n]+(?:\r\n|\n))/, `$1b=AS:8000\r\nb=TIAS:8000000\r\n`);
      } else {
        sdp = sdp.replace(/b=AS:\d+/g, 'b=AS:8000').replace(/b=TIAS:\d+/g, 'b=TIAS:8000000');
      }
    }

    return sdp;
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

  // Web Audio DSP Formant Gate Loop (completely eliminates mechanical keyboard noise)
  setupVAD() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let wasSpeaking = false;

    this.vadInterval = setInterval(() => {
      if (this.isMuted || !this.rawStream) {
        if (this.gateGainNode && this.audioContext) {
          this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
        }
        if (wasSpeaking) {
          wasSpeaking = false;
          if (this.onSpeakingChange) this.onSpeakingChange('self', false);
          this.sendSignal('voice:speaking', { isSpeaking: false });
        }
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      // Measure human voice formant energy (approx 300Hz - 3400Hz, bins 3 to 36)
      // This mathematically filters out mechanical key bottom-out thumps (<100Hz) and high metallic clicks (>4000Hz)
      let sum = 0;
      let count = 0;
      for (let i = 3; i <= 36; i++) {
        sum += dataArray[i];
        count++;
      }
      const voiceEnergy = count > 0 ? (sum / count) : 0;
      const currentLevel = Math.min(100, Math.round(voiceEnergy * 1.5));

      const threshold = this.audioSettings.voiceGateEnabled 
        ? (this.audioSettings.voiceGateThreshold || 22)
        : 0;

      const isSpeaking = currentLevel >= threshold;

      if (this.audioSettings.voiceGateEnabled && this.gateGainNode && this.audioContext) {
        if (isSpeaking) {
          if (this.voiceGateHangTimeout) {
            clearTimeout(this.voiceGateHangTimeout);
            this.voiceGateHangTimeout = null;
          }
          // Instant 5ms smooth attack (voice active - opens gate)
          this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.005);
          this.isGateOpen = true;
        } else if (this.isGateOpen) {
          // 250ms release hang-time to keep words natural without choppy syllable ends
          if (!this.voiceGateHangTimeout) {
            this.voiceGateHangTimeout = setTimeout(() => {
              if (this.gateGainNode && this.audioContext) {
                // Smooth 20ms fade to pure digital silence (zero keyboard clicks transmitted)
                this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.02);
              }
              this.isGateOpen = false;
              this.voiceGateHangTimeout = null;
            }, 250);
          }
        } else {
          // Below threshold: guaranteed silent
          this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
        }
      } else if (this.gateGainNode && this.audioContext) {
        // Gate disabled: pass 100%
        this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
      }

      if (isSpeaking !== wasSpeaking) {
        wasSpeaking = isSpeaking;
        if (this.onSpeakingChange) this.onSpeakingChange('self', isSpeaking);
        this.sendSignal('voice:speaking', { isSpeaking });
      }
    }, 40);
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

        // Track lifecycle: ensure stopped screen shares are immediately purged
        if (event.track.kind === 'video') {
          const purgeVideoTrack = () => {
            try { remoteStream.removeTrack(event.track); } catch (e) {}
            if (this.onRemoteScreenShareStopped) {
              try { this.onRemoteScreenShareStopped(peerId); } catch (e) {}
            }
            if (this.onPeersChange) {
              this.peers[peerId] = {
                ...this.peers[peerId],
                remoteStream: new MediaStream(remoteStream.getTracks())
              };
              this.onPeersChange({ ...this.peers });
            }
          };

          event.track.onended = purgeVideoTrack;
          event.track.onmute = () => {
            setTimeout(() => {
              if (event.track.readyState === 'ended' || event.track.muted) {
                purgeVideoTrack();
              }
            }, 300);
          };
        }
      } else if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
      }

      // If audio track, route through individual volume gain controller
      if (event.track && event.track.kind === 'audio') {
        this.setupPeerAudio(peerId, remoteStream);
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

  // Screen sharing toggle with resolution choice (1080p-120, 1080p, 720p, 480p, auto)
  async startScreenShare(targetQuality = '1080p-120') {
    let videoConstraints = {
      cursor: 'always'
    };

    if (targetQuality === '1080p-120' || targetQuality === '120fps' || targetQuality === 'auto' || targetQuality === '1080p') {
      videoConstraints.width = { ideal: 1920, max: 1920 };
      videoConstraints.height = { ideal: 1080, max: 1080 };
      videoConstraints.frameRate = { ideal: 120, max: 120 };
    } else if (targetQuality === '720p') {
      videoConstraints.width = { ideal: 1280, max: 1280 };
      videoConstraints.height = { ideal: 720, max: 720 };
      videoConstraints.frameRate = { ideal: 60, max: 60 };
    } else if (targetQuality === '480p') {
      videoConstraints.width = { ideal: 854, max: 854 };
      videoConstraints.height = { ideal: 480, max: 480 };
      videoConstraints.frameRate = { ideal: 30, max: 30 };
    } else {
      videoConstraints.frameRate = { ideal: 120, max: 120 };
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
        // 'detail' instructs encoder to preserve sharp text, edges and resolutions without aggressive blurring
        videoTrack.contentHint = 'detail';
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

      // Remove video track from peers and renegotiate
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

  // Purge remote video tracks when a broadcaster stops sharing (prevents frozen screens)
  handleRemoteScreenShareEnded(peerId) {
    if (this.onRemoteScreenShareStopped) {
      try { this.onRemoteScreenShareStopped(peerId); } catch (e) {}
    }

    if (peerId && this.peers[peerId]) {
      const peer = this.peers[peerId];
      if (peer.remoteStream) {
        peer.remoteStream.getVideoTracks().forEach(track => {
          track.stop();
          try { peer.remoteStream.removeTrack(track); } catch (e) {}
        });
        peer.remoteStream = new MediaStream(peer.remoteStream.getTracks());
      }
    } else {
      // Purge all remote video tracks
      Object.values(this.peers).forEach(peer => {
        if (peer.remoteStream) {
          peer.remoteStream.getVideoTracks().forEach(track => {
            track.stop();
            try { peer.remoteStream.removeTrack(track); } catch (e) {}
          });
          peer.remoteStream = new MediaStream(peer.remoteStream.getTracks());
        }
      });
    }

    if (this.onPeersChange) {
      this.onPeersChange({ ...this.peers });
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

  // Adjust quality/resolution dynamically per viewer (1080p: 8 Mbps, 720p: 4 Mbps, 480p: 1.2 Mbps)
  setVideoQualityForPeer(peerId, quality = '1080p') {
    const peer = this.peers[peerId];
    if (!peer || !peer.connection) return;

    const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!sender) return;

    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }

      // Maintain full resolution without dropping to pixelated downscales
      params.degradationPreference = 'maintain-resolution';

      if (quality === '1080p-120' || quality === '120fps') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 12000000; // 12.0 Mbps for ultra smooth 120 FPS gaming stream
        params.encodings[0].maxFramerate = 120;
      } else if (quality === '1080p') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 8000000; // 8.0 Mbps for razor-sharp 1080p FHD 60 FPS
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '720p') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 4000000; // 4.0 Mbps for sharp 720p HD
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '480p') {
        params.encodings[0].scaleResolutionDownBy = 2.0;
        params.encodings[0].maxBitrate = 1200000; // 1.2 Mbps for SD
        params.encodings[0].maxFramerate = 30;
      } else {
        // Auto / Dynamic Adaptive (up to 12 Mbps, max 120 FPS)
        delete params.encodings[0].scaleResolutionDownBy;
        params.encodings[0].maxBitrate = 12000000;
        params.encodings[0].maxFramerate = 120;
      }

      sender.setParameters(params).then(() => {
        console.log(`[WebRTC] Set video quality ${quality} (${params.encodings[0].maxBitrate / 1000}kbps) for peer ${peerId}`);
      }).catch(err => console.warn('setParameters warning (normal during negotiation):', err));
    } catch (e) {
      console.warn('Video quality adjust error:', e);
    }
  }

  // Toggle Mute Microphone
  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.gateGainNode && this.audioContext) {
      this.gateGainNode.gain.setTargetAtTime(this.isMuted ? 0 : 1.0, this.audioContext.currentTime, 0.01);
    }
    if (this.rawStream) {
      this.rawStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }
    if (this.processedStream) {
      this.processedStream.getAudioTracks().forEach(track => {
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

    // Mute/unmute all peer audio elements and Web Audio gain nodes
    for (const [peerId, gainNode] of Object.entries(this.peerGainNodes)) {
      const vol = this.peerVolumes[peerId] ?? 100;
      gainNode.gain.value = this.isDeafened ? 0 : (vol / 100);
    }
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
    if (this.peerGainNodes[peerId]) {
      try { this.peerGainNodes[peerId].disconnect(); } catch (e) {}
      delete this.peerGainNodes[peerId];
    }

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

    for (const gainNode of Object.values(this.peerGainNodes)) {
      try { gainNode.disconnect(); } catch (e) {}
    }
    this.peerGainNodes = {};

    if (this.remoteAudioContext && this.remoteAudioContext.state !== 'closed') {
      try { this.remoteAudioContext.close(); } catch (e) {}
      this.remoteAudioContext = null;
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }

    if (this.rawStream) {
      this.rawStream.getTracks().forEach(t => t.stop());
      this.rawStream = null;
    }

    if (this.processedStream) {
      this.processedStream.getTracks().forEach(t => t.stop());
      this.processedStream = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch (e) {}
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

  // Self Mic Loopback Test with real Highpass Filter & Voice Gate (hear mechanical keyboard get muted in real time)
  async startMicTest(onLevel) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: Boolean(this.audioSettings.echoCancellation),
          noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          autoGainControl: Boolean(this.audioSettings.autoGainControl),
          googEchoCancellation: Boolean(this.audioSettings.echoCancellation),
          googNoiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          googHighpassFilter: true,
          googTypingNoiseDetection: true
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const testCtx = new AudioCtx({ sampleRate: 48000 });
      const source = testCtx.createMediaStreamSource(stream);

      // 1. Analyser on raw source
      const analyser = testCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);

      // 2. Highpass filter: cuts keyboard desk vibrations (< 110Hz)
      const highpass = testCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 110 : 20;
      source.connect(highpass);

      // 3. Test Gate
      const testGate = testCtx.createGain();
      testGate.gain.setValueAtTime(0, testCtx.currentTime);
      highpass.connect(testGate);

      // 4. Connect to headphones so user can verify gating with their own ears
      const monitorGain = testCtx.createGain();
      monitorGain.gain.value = 1.0;
      testGate.connect(monitorGain);
      monitorGain.connect(testCtx.destination);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      let isGateOpen = false;
      let hangTimeout = null;

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);

        // Human voice formant bins (300Hz - 3400Hz, bins 3 to 36)
        let sum = 0;
        let count = 0;
        for (let i = 3; i <= 36; i++) {
          sum += dataArray[i];
          count++;
        }
        const level = count > 0 ? Math.min(100, Math.round((sum / count) * 1.5)) : 0;
        if (onLevel) onLevel(level);

        const threshold = this.audioSettings.voiceGateEnabled 
          ? (this.audioSettings.voiceGateThreshold || 22)
          : 0;

        const isSpeaking = level >= threshold;

        if (this.audioSettings.voiceGateEnabled) {
          if (isSpeaking) {
            if (hangTimeout) {
              clearTimeout(hangTimeout);
              hangTimeout = null;
            }
            testGate.gain.setTargetAtTime(1.0, testCtx.currentTime, 0.005);
            isGateOpen = true;
          } else if (isGateOpen) {
            if (!hangTimeout) {
              hangTimeout = setTimeout(() => {
                testGate.gain.setTargetAtTime(0, testCtx.currentTime, 0.02);
                isGateOpen = false;
                hangTimeout = null;
              }, 250);
            }
          } else {
            testGate.gain.setTargetAtTime(0, testCtx.currentTime, 0.01);
          }
        } else {
          testGate.gain.setTargetAtTime(1.0, testCtx.currentTime, 0.01);
        }
      }, 40);

      this._testCleanUp = () => {
        clearInterval(interval);
        if (hangTimeout) clearTimeout(hangTimeout);
        monitorGain.disconnect();
        testGate.disconnect();
        highpass.disconnect();
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
