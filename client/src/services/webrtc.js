import { socket } from './socket';
import { realtimeSignaling } from './realtimeSignaling';
import { soundEffects } from './soundEffects';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],
  iceCandidatePoolSize: 10
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
    this.currentUserId = null;

    // Master Microphone Input & Headphone Output volume controls (0% to 200%)
    this.inputVolume = Number(localStorage.getItem('turkcord_input_volume') || 100);
    this.outputVolume = Number(localStorage.getItem('turkcord_output_volume') || 100);
    this.micGainNode = null;
    this.keyboardFilterShelf = null;

    // Audio Input & Output Device Selection (Persisted)
    this.selectedInputDeviceId = localStorage.getItem('turkcord_input_device_id') || 'default';
    this.selectedOutputDeviceId = localStorage.getItem('turkcord_output_device_id') || 'default';
  }

  // Enumerate all available audio input and output devices
  async getAudioDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return { inputs: [], outputs: [] };
      }

      // Check if devices currently have labels; if not, request permission briefly
      let devices = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = devices.some(d => d.label && d.label.length > 0);
      if (!hasLabels && navigator.mediaDevices.getUserMedia) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          tempStream.getTracks().forEach(t => t.stop());
          devices = await navigator.mediaDevices.enumerateDevices();
        } catch (permErr) {
          console.warn('[WebRTC] Media permission error while querying device labels:', permErr);
        }
      }

      const inputs = devices
        .filter(d => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Mikrofon ${index + 1} (${d.deviceId.slice(0, 8)})`
        }));

      const outputs = devices
        .filter(d => d.kind === 'audiooutput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Hoparlör / Kulaklık ${index + 1} (${d.deviceId.slice(0, 8)})`
        }));

      return { inputs, outputs };
    } catch (err) {
      console.warn('[WebRTC] Error enumerating audio devices:', err);
      return { inputs: [], outputs: [] };
    }
  }

  // Switch microphone input device dynamically without dropping connection
  async setInputDevice(deviceId) {
    const targetId = deviceId || 'default';
    this.selectedInputDeviceId = targetId;
    try {
      localStorage.setItem('turkcord_input_device_id', targetId);
    } catch (e) {}

    // If local stream is active, acquire new stream with new deviceId and hot-swap tracks
    if (this.rawStream && this.rawStream.active) {
      try {
        const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000
        };
        if (targetId !== 'default') {
          audioConstraints.deviceId = { exact: targetId };
        }

        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });

        const newTrack = newStream.getAudioTracks()[0];
        if (newTrack) {
          newTrack.enabled = !this.isMuted;
          if ('contentHint' in newTrack) newTrack.contentHint = 'speech';

          // Replace track in all active peer connections
          for (const peer of Object.values(this.peers)) {
            if (peer.connection) {
              const senders = peer.connection.getSenders();
              const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
              if (audioSender) {
                await audioSender.replaceTrack(newTrack).catch(e => console.warn('[WebRTC] replaceTrack error:', e));
              }
            }
          }

          // Stop old tracks and update reference
          this.rawStream.getTracks().forEach(t => t.stop());
          this.rawStream = newStream;
          this.localStream = newStream;

          // Reconnect audio analyser for avatar glow
          try {
            if (this.audioContext && this.audioContext.state !== 'closed') {
              const source = this.audioContext.createMediaStreamSource(this.rawStream);
              this.analyser = this.audioContext.createAnalyser();
              this.analyser.fftSize = 512;
              this.analyser.smoothingTimeConstant = 0.2;
              source.connect(this.analyser);
              this.setupVAD();
            }
          } catch (e) {
            console.warn('[WebRTC] Analyser reconnect error:', e);
          }
        }
      } catch (err) {
        console.error('[WebRTC] Failed to switch microphone device:', err);
      }
    }
  }

  // Switch speaker / headphone output device dynamically
  async setOutputDevice(deviceId) {
    const targetId = deviceId || 'default';
    this.selectedOutputDeviceId = targetId;
    try {
      localStorage.setItem('turkcord_output_device_id', targetId);
    } catch (e) {}

    const sinkId = targetId === 'default' ? '' : targetId;

    try {
      soundEffects.setOutputDevice(targetId);
    } catch (e) {}

    for (const peer of Object.values(this.peers)) {
      if (peer.audioEl && typeof peer.audioEl.setSinkId === 'function') {
        try {
          await peer.audioEl.setSinkId(sinkId);
        } catch (e) {
          console.warn('[WebRTC] Error setting sinkId for peer:', e);
        }
      }
    }
  }

  // Play a crisp test chime through the selected speaker/headphone
  async testOutputDevice(deviceId) {
    try {
      const targetDevice = deviceId || this.selectedOutputDeviceId || 'default';
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      if (typeof ctx.setSinkId === 'function' && targetDevice !== 'default') {
        try {
          await ctx.setSinkId(targetDevice);
        } catch (e) {}
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.28, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);

      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 600);
      return true;
    } catch (err) {
      console.warn('[WebRTC] testOutputDevice error:', err);
      return false;
    }
  }

  setInputVolume(volumePercent) {
    const clamped = Math.min(200, Math.max(0, Number(volumePercent) || 0));
    this.inputVolume = clamped;
    try { localStorage.setItem('turkcord_input_volume', String(clamped)); } catch (e) {}
    if (this.micGainNode && this.audioContext) {
      this.micGainNode.gain.setTargetAtTime(clamped / 100, this.audioContext.currentTime, 0.01);
    }
  }

  setOutputVolume(volumePercent) {
    const clamped = Math.min(200, Math.max(0, Number(volumePercent) || 0));
    this.outputVolume = clamped;
    try { localStorage.setItem('turkcord_output_volume', String(clamped)); } catch (e) {}
    this.updateAllPeerPlayoutVolumes();
  }

  getEffectivePeerVolume(peerId) {
    const peerVol = this.peerVolumes[peerId] ?? 100;
    return Math.round((peerVol * (this.outputVolume / 100)));
  }

  updateAllPeerPlayoutVolumes() {
    for (const [peerId, peer] of Object.entries(this.peers)) {
      if (peer.audioEl) {
        if (this.isDeafened) {
          peer.audioEl.muted = true;
          peer.audioEl.volume = 0;
        } else {
          peer.audioEl.muted = false;
          peer.audioEl.volume = Math.min(1.0, Math.max(0, this.getEffectivePeerVolume(peerId) / 100));
        }
      }
    }
  }

  setCurrentUserId(id) {
    this.currentUserId = id;
  }

  resumeAudioContexts() {
    try {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      if (this.remoteAudioContext && this.remoteAudioContext.state === 'suspended') {
        this.remoteAudioContext.resume().catch(() => {});
      }
      for (const peer of Object.values(this.peers)) {
        if (peer.audioEl && peer.audioEl.paused && peer.remoteStream) {
          peer.audioEl.play().catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[WebRTC] resumeAudioContexts err:', e);
    }
  }

  loadPeerVolumes() {
    try {
      const saved = localStorage.getItem('turkcord_peer_volumes');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  }

  setPeerVolume(peerId, volumePercent) {
    const clamped = Math.min(200, Math.max(0, Number(volumePercent) || 0));
    this.peerVolumes[peerId] = clamped;
    try {
      localStorage.setItem('turkcord_peer_volumes', JSON.stringify(this.peerVolumes));
    } catch (e) {}

    const effective = this.getEffectivePeerVolume(peerId);

    // 1. Web Audio Gain Node (supports up to 200% boost!)
    if (this.peerGainNodes[peerId]) {
      this.peerGainNodes[peerId].gain.setTargetAtTime(
        this.isDeafened ? 0 : (effective / 100),
        this.remoteAudioContext?.currentTime || 0,
        0.01
      );
    }

    // 2. Native audio element (only unmuted if Web Audio is not handling this peer)
    const peer = this.peers[peerId];
    if (peer && peer.audioEl) {
      const isWebAudioActive = this.remoteAudioContext && this.remoteAudioContext.state === 'running';
      if (!isWebAudioActive || !this.peerGainNodes[peerId]) {
        peer.audioEl.volume = Math.min(1.0, effective / 100);
        peer.audioEl.muted = this.isDeafened || effective === 0;
      }
    }

    return clamped;
  }

  getPeerVolume(peerId) {
    return this.peerVolumes[peerId] ?? 100;
  }

  setupPeerAudio(peerId, remoteStream) {
    if (!remoteStream) return;
    const peer = this.peers[peerId];
    if (!peer) return;

    // 1. Ensure peer audioEl is created and attached to DOM
    let audioEl = peer.audioEl || document.getElementById(`audio-peer-${peerId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio-peer-${peerId}`;
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      peer.audioEl = audioEl;
    }

    // Apply selected output device sinkId if supported
    if (this.selectedOutputDeviceId && this.selectedOutputDeviceId !== 'default' && typeof audioEl.setSinkId === 'function') {
      audioEl.setSinkId(this.selectedOutputDeviceId).catch(() => {});
    }

    // 2. Set stream directly
    if (audioEl.srcObject !== remoteStream) {
      audioEl.srcObject = remoteStream;
    }

    // 3. Audio volume & unmuted - Never mute unless user is intentionally deafened!
    const effectiveVol = this.getEffectivePeerVolume(peerId);
    audioEl.volume = this.isDeafened ? 0 : Math.min(1.0, Math.max(0, effectiveVol / 100));
    audioEl.muted = Boolean(this.isDeafened);

    // 4. Force play
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.warn(`[WebRTC] audioEl autoplay waiting for user interaction for ${peerId}:`, e);
        const unlock = () => {
          audioEl.play().catch(() => {});
          window.removeEventListener('click', unlock);
          window.removeEventListener('keydown', unlock);
        };
        window.addEventListener('click', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
      });
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
      this.highpassFilter.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 140 : 20;
    }
    if (this.keyboardFilterShelf) {
      this.keyboardFilterShelf.gain.value = this.audioSettings.keyboardFilterEnabled !== false ? -18 : 0;
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

  // Unified signaling dispatcher: Single authoritative signaling bus
  sendSignal(event, data) {
    if (this.onSignal) {
      try { this.onSignal(event, data); } catch (e) {}
    }

    if (socket && socket.connected) {
      // Primary: Fast dedicated Socket.io server (<5ms, room-aware)
      socket.emit(event, data);
    } else {
      // Fallback: Supabase Realtime when Socket server is not reachable (e.g. serverless)
      if (event === 'webrtc:offer') {
        realtimeSignaling.sendOffer(data.to, data.offer);
      } else if (event === 'webrtc:answer') {
        realtimeSignaling.sendAnswer(data.to, data.answer);
      } else if (event === 'webrtc:ice-candidate') {
        realtimeSignaling.sendCandidate(data.to, data.candidate);
      } else if (event === 'voice:speaking') {
        realtimeSignaling.sendSpeaking(data.isSpeaking);
      }
    }
  }

  // Initialize local microphone with studio DSP pipeline (cuts mechanical keyboard noise 100%)
  async initLocalAudio() {
    if (this.localStream && this.localStream.getAudioTracks().length > 0 && this.localStream.getAudioTracks()[0].readyState === 'live') {
      return this.localStream;
    }

    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000
      };
      if (this.selectedInputDeviceId && this.selectedInputDeviceId !== 'default') {
        audioConstraints.deviceId = { exact: this.selectedInputDeviceId };
      }

      this.rawStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });

      this.localStream = this.rawStream;

      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        track.enabled = !this.isMuted;
        if ('contentHint' in track) {
          track.contentHint = 'speech';
        }
      }

      // Initialize Web Audio Analyser ONLY for speaking indicator / avatar glow
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!this.audioContext || this.audioContext.state === 'closed') {
          this.audioContext = new AudioCtx({ sampleRate: 48000 });
        }
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(() => {});
        }
        const source = this.audioContext.createMediaStreamSource(this.rawStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.2;
        source.connect(this.analyser);
      } catch (e) {
        console.warn('[WebRTC] Analyser setup error:', e);
      }

      this.setupVAD();
      return this.localStream;
    } catch (err) {
      console.error('[WebRTC] Microphone access error:', err);
      throw err;
    }
  }

  // Optimize SDP specifically for Gaming: Opus Audio with inband FEC & Crisp Screen Share
  optimizeSdpForGaming(sdp) {
    if (!sdp) return sdp;

    // 1. Opus Audio Optimization (Forward Error Correction enabled, continuous voice)
    const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (opusMatch) {
      const opusPayload = opusMatch[1];
      const gamingParams = 'maxaveragebitrate=64000;stereo=1;sprop-stereo=1;useinbandfec=1;usedtx=0';

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

  // Visual Speaking Detection (for avatar glow & UI indicator)
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
        if (wasSpeaking) {
          wasSpeaking = false;
          if (this.onSpeakingChange) this.onSpeakingChange('self', false);
          this.sendSignal('voice:speaking', { isSpeaking: false });
        }
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const isSpeaking = avg > 8; // Gentle speaking threshold for avatar glow

      if (isSpeaking !== wasSpeaking) {
        wasSpeaking = isSpeaking;
        if (this.onSpeakingChange) this.onSpeakingChange('self', isSpeaking);
        this.sendSignal('voice:speaking', { isSpeaking });
      }
    }, 50);
  }

  // Connect to an existing peer (Caller initiates offer)
  async createPeerConnection(peerId, isInitiator) {
    if (this.peers[peerId]) {
      const existingPc = this.peers[peerId].connection;
      if (existingPc && !['closed', 'failed', 'disconnected'].includes(existingPc.connectionState) && !isInitiator) {
        return existingPc;
      }
      this.closePeer(peerId);
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
    if (this.selectedOutputDeviceId && this.selectedOutputDeviceId !== 'default' && typeof audioEl.setSinkId === 'function') {
      audioEl.setSinkId(this.selectedOutputDeviceId).catch(() => {});
    }

    this.peers[peerId] = {
      connection: pc,
      remoteStream,
      audioEl,
      user: null,
      pendingCandidates: []
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

        // Track lifecycle: ensure stopped screen shares are safely purged WITHOUT killing audio
        if (event.track.kind === 'video') {
          const purgeVideoTrack = () => {
            try { remoteStream.removeTrack(event.track); } catch (e) {}
            if (this.onRemoteScreenShareStopped) {
              try { this.onRemoteScreenShareStopped(peerId); } catch (e) {}
            }
            // CRITICAL: Keep audio flowing through audioEl
            if (this.peers[peerId]?.audioEl && remoteStream.getAudioTracks().length > 0) {
              this.peers[peerId].audioEl.srcObject = remoteStream;
              this.peers[peerId].audioEl.play().catch(() => {});
            }
            this.setupPeerAudio(peerId, remoteStream);
            if (this.onPeersChange) {
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

      // If audio track, ensure native audio element playback
      if ((event.track && event.track.kind === 'audio') || remoteStream.getAudioTracks().length > 0) {
        this.setupPeerAudio(peerId, remoteStream);
      }

      this.optimizePeer(pc);

      if (this.onPeersChange) {
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
      console.log(`[WebRTC] Peer ${peerId} connectionState:`, pc.connectionState);
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

  // Handle incoming Offer from a peer with collision handling and candidate buffer flush
  async handleOffer(peerId, offer) {
    if (!this.localStream) {
      try {
        await this.initLocalAudio();
      } catch (e) {
        console.warn('[WebRTC] handleOffer initLocalAudio error:', e);
      }
    }

    let peer = this.peers[peerId];
    let pc;
    if (!peer || (peer.connection && ['closed', 'failed', 'disconnected'].includes(peer.connection.connectionState))) {
      if (peer) this.closePeer(peerId);
      pc = await this.createPeerConnection(peerId, false);
    } else {
      pc = peer.connection;
    }

    // Ensure our local audio tracks are attached to pc
    if (this.localStream && pc) {
      const senders = pc.getSenders();
      this.localStream.getAudioTracks().forEach(track => {
        if (!senders.some(s => s.track && s.track.id === track.id)) {
          pc.addTrack(track, this.localStream);
        }
      });
    }

    try {
      // Glare / collision handling: If already in have-local-offer, resolve politely
      if (pc.signalingState !== 'stable') {
        const isPolite = (this.currentUserId || '') < (peerId || '');
        if (isPolite) {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch (e) {
            console.warn('[WebRTC] Rollback error:', e);
          }
        } else {
          console.log('[WebRTC] Glare collision ignored (impolite peer)');
          return;
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingCandidates(peerId);

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
    } catch (err) {
      console.error('[WebRTC] handleOffer error for ' + peerId, err);
    }
  }

  // Handle incoming Answer with candidate buffer flush
  async handleAnswer(peerId, answer) {
    const peer = this.peers[peerId];
    if (peer && peer.connection) {
      try {
        if (peer.connection.signalingState === 'have-local-offer') {
          await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
          await this.flushPendingCandidates(peerId);
        }
      } catch (err) {
        console.warn('[WebRTC] handleAnswer error for ' + peerId, err);
      }
    }
  }

  // Flush queued ICE candidates that arrived before remoteDescription
  async flushPendingCandidates(peerId) {
    const peer = this.peers[peerId];
    if (!peer || !peer.connection || !peer.pendingCandidates || peer.pendingCandidates.length === 0) return;
    const candidates = [...peer.pendingCandidates];
    peer.pendingCandidates = [];
    for (const cand of candidates) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Error flushing candidate:', e);
      }
    }
  }

  // Handle incoming ICE candidate with buffering
  async handleCandidate(peerId, candidate) {
    const peer = this.peers[peerId];
    if (!peer || !peer.connection) return;

    if (peer.connection.remoteDescription && peer.connection.remoteDescription.type) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Error adding ice candidate:', e);
      }
    } else {
      if (!peer.pendingCandidates) peer.pendingCandidates = [];
      peer.pendingCandidates.push(candidate);
    }
  }

  // Screen sharing toggle with resolution choice (1080p-120, 1080p, 720p, 480p, auto)
  // Echo cancellation enabled to prevent feedback loops
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
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

  // Purge remote video tracks when a broadcaster stops sharing WITHOUT killing peer audio
  handleRemoteScreenShareEnded(peerId) {
    if (this.onRemoteScreenShareStopped) {
      try { this.onRemoteScreenShareStopped(peerId); } catch (e) {}
    }

    const cleanPeerStream = (peer, id) => {
      if (!peer || !peer.remoteStream) return;
      peer.remoteStream.getVideoTracks().forEach(track => {
        track.stop();
        try { peer.remoteStream.removeTrack(track); } catch (e) {}
      });

      // Ensure audio stays attached and actively playing
      if (peer.audioEl && peer.remoteStream.getAudioTracks().length > 0) {
        peer.audioEl.srcObject = peer.remoteStream;
        peer.audioEl.play().catch(() => {});
      }
      this.setupPeerAudio(id, peer.remoteStream);
    };

    if (peerId && this.peers[peerId]) {
      cleanPeerStream(this.peers[peerId], peerId);
    } else {
      Object.entries(this.peers).forEach(([id, peer]) => {
        cleanPeerStream(peer, id);
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
  toggleMute(targetState = null) {
    if (typeof targetState === 'boolean') {
      this.isMuted = targetState;
    } else {
      this.isMuted = !this.isMuted;
    }

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
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !this.isMuted;
      });
    }

    this.sendSignal('voice:state', { isMuted: this.isMuted });
    return this.isMuted;
  }

  // Toggle Deafen (Mutes incoming audio and self microphone without echo)
  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    
    // If deafened, also auto-mute microphone like Discord
    if (this.isDeafened && !this.isMuted) {
      this.toggleMute(true);
    } else if (!this.isDeafened && this.isMuted) {
      this.toggleMute(false);
    }

    // Safely update all peer playout nodes without double-play echo
    this.updateAllPeerPlayoutVolumes();

    this.sendSignal('voice:state', { isDeafened: this.isDeafened, isMuted: this.isMuted });
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

  // Leave voice room (pass keepLocalAudio = true when switching rooms to keep microphone active without latency)
  leaveRoom(keepLocalAudio = false) {
    this.stopScreenShare();

    for (const peerId of Object.keys(this.peers)) {
      this.closePeer(peerId);
    }

    for (const gainNode of Object.values(this.peerGainNodes)) {
      try { gainNode.disconnect(); } catch (e) {}
    }
    this.peerGainNodes = {};

    if (!keepLocalAudio) {
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
    }

    if (!keepLocalAudio) {
      if (socket && socket.connected) {
        socket.emit('voice:leave');
      }
    }
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
      const audioConstraints = {
        echoCancellation: Boolean(this.audioSettings.echoCancellation),
        noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
        autoGainControl: Boolean(this.audioSettings.autoGainControl),
        googEchoCancellation: Boolean(this.audioSettings.echoCancellation),
        googNoiseSuppression: Boolean(this.audioSettings.noiseSuppression),
        googHighpassFilter: true,
        googTypingNoiseDetection: true
      };
      if (this.selectedInputDeviceId && this.selectedInputDeviceId !== 'default') {
        audioConstraints.deviceId = { exact: this.selectedInputDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const testCtx = new AudioCtx({ sampleRate: 48000 });
      if (this.selectedOutputDeviceId && this.selectedOutputDeviceId !== 'default' && typeof testCtx.setSinkId === 'function') {
        try {
          await testCtx.setSinkId(this.selectedOutputDeviceId);
        } catch (e) {}
      }
      const source = testCtx.createMediaStreamSource(stream);

      // 1. Analyser on raw source
      const analyser = testCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);

      // 2. Highpass filter: cuts keyboard desk vibrations (< 140Hz)
      const highpass = testCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 140 : 20;
      source.connect(highpass);

      // 2b. Highshelf filter: cuts switch clicks
      const highshelf = testCtx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 4000;
      highshelf.gain.value = this.audioSettings.keyboardFilterEnabled !== false ? -18 : 0;
      highpass.connect(highshelf);

      // 3. Test Gate
      const testGate = testCtx.createGain();
      testGate.gain.setValueAtTime(0, testCtx.currentTime);
      highshelf.connect(testGate);

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
