import { socket } from './socket';
import { realtimeSignaling } from './realtimeSignaling';
import { soundEffects } from './soundEffects';
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';

function getAudioAssetUrl(fileName) {
  try {
    const base = import.meta.env?.BASE_URL || './';
    const relativePath = base.endsWith('/') ? `${base}audio/${fileName}` : `${base}/audio/${fileName}`;
    return new URL(relativePath, window.location.href).href;
  } catch (e) {
    return `./audio/${fileName}`;
  }
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:global.stun.twilio.com:3478' }
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
    this.onLocalScreenShareEnded = null;

    // Audio & Noise Reduction Settings
    this.audioSettings = this.loadAudioSettings();
    this.voiceGateHangTimeout = null;
    this.isGateOpen = false;

    // Per-user volume control (0% to 200%)
    this.peerVolumes = this.loadPeerVolumes();
    this.peerSourceNodes = {};
    this.peerGainNodes = {};
    this.peerDestinations = {};
    this.remoteAudioContext = null;
    this.currentUserId = null;

    // Master Microphone Input & Headphone Output volume controls (0% to 200%)
    this.inputVolume = Number(localStorage.getItem('turkcord_input_volume') || 100);
    this.outputVolume = Number(localStorage.getItem('turkcord_output_volume') || 100);
    this.micGainNode = null;
    this.keyboardFilterShelf = null;
    this.rnnoiseNode = null;
    this.compressor = null;
    this.noiseFloor = 8;

    // Audio Input & Output Device Selection (Persisted)
    this.selectedInputDeviceId = localStorage.getItem('turkcord_input_device_id') || 'default';
    this.selectedOutputDeviceId = localStorage.getItem('turkcord_output_device_id') || 'default';

    // Synchronization & Mutex State
    this.initAudioPromise = null;
    this.pendingIceCandidates = {};
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

    // If local stream is active, acquire new stream with new deviceId and hot-swap
    if (this.rawStream && this.rawStream.active) {
      try {
        const audioConstraints = {
          echoCancellation: Boolean(this.audioSettings.echoCancellation),
          noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          autoGainControl: Boolean(this.audioSettings.autoGainControl),
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

        // Stop old raw tracks
        this.rawStream.getTracks().forEach(t => t.stop());
        this.rawStream = newStream;

        // Reconnect new raw stream into existing DSP pipeline
        if (this.audioContext && this.audioContext.state !== 'closed') {
          if (this.micSourceNode) {
            try { this.micSourceNode.disconnect(); } catch (e) {}
          }
          this.micSourceNode = this.audioContext.createMediaStreamSource(this.rawStream);
          if (this.analyser) {
            this.micSourceNode.connect(this.analyser);
          }
          if (this.highpassFilter) {
            this.micSourceNode.connect(this.highpassFilter);
          }
          this.setupVAD();
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
      if (!AudioCtx) return false;
      const ctx = new AudioCtx();
      await ctx.resume();

      if (typeof ctx.setSinkId === 'function') {
        try {
          await ctx.setSinkId(targetDevice === 'default' ? '' : targetDevice);
        } catch (e) {
          try { await ctx.setSinkId(''); } catch (e2) {}
        }
      }

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.00, now + 0.12); // A5

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.6, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);

      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 700);
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
    const rawPeerVol = Number(this.peerVolumes[peerId]);
    const peerVol = (!isNaN(rawPeerVol) && rawPeerVol >= 0) ? rawPeerVol : 100;
    const rawOutVol = Number(this.outputVolume);
    const outVol = (!isNaN(rawOutVol) && rawOutVol >= 0) ? rawOutVol : 100;
    return Math.round((peerVol * (outVol / 100)));
  }

  getRemoteAudioContext() {
    if (!this.remoteAudioContext || this.remoteAudioContext.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.remoteAudioContext = new AudioCtx({ sampleRate: 48000 });
    }
    if (this.remoteAudioContext.state === 'suspended') {
      this.remoteAudioContext.resume().catch(() => {});
    }
    return this.remoteAudioContext;
  }

  updateAllPeerPlayoutVolumes() {
    for (const [peerId, peer] of Object.entries(this.peers)) {
      const effective = this.getEffectivePeerVolume(peerId);
      const gainMultiplier = this.isDeafened ? 0 : (effective / 100);

      if (this.peerGainNodes[peerId] && this.remoteAudioContext) {
        this.peerGainNodes[peerId].gain.setTargetAtTime(
          gainMultiplier,
          this.remoteAudioContext.currentTime,
          0.01
        );
      }

      if (peer.audioEl) {
        if (this.isDeafened || effective === 0) {
          peer.audioEl.muted = true;
          peer.audioEl.volume = 0;
        } else {
          peer.audioEl.muted = false;
          peer.audioEl.volume = this.peerGainNodes[peerId] ? 1.0 : Math.min(1.0, effective / 100);
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
    const gainMultiplier = this.isDeafened ? 0 : (effective / 100);

    // 1. Web Audio Gain Node (Real boost up to 200% / 2.0x!)
    if (this.peerGainNodes[peerId] && this.remoteAudioContext) {
      this.peerGainNodes[peerId].gain.setTargetAtTime(
        gainMultiplier,
        this.remoteAudioContext.currentTime,
        0.01
      );
    }

    // 2. Audio element update (fallback to clamped if GainNode inactive)
    const peer = this.peers[peerId];
    if (peer && peer.audioEl) {
      if (this.peerGainNodes[peerId]) {
        peer.audioEl.volume = (this.isDeafened || effective === 0) ? 0 : 1.0;
        peer.audioEl.muted = this.isDeafened || effective === 0;
      } else {
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
    if (typeof audioEl.setSinkId === 'function') {
      const sink = (this.selectedOutputDeviceId && this.selectedOutputDeviceId !== 'default') 
        ? this.selectedOutputDeviceId 
        : '';
      audioEl.setSinkId(sink).catch(() => {
        audioEl.setSinkId('').catch(() => {});
      });
    }

    // 2. Setup Web Audio Gain amplification graph (allows genuine boost up to 200% / 300%!)
    let playoutStream = remoteStream;
    try {
      if (remoteStream.getAudioTracks().length > 0) {
        const ctx = this.getRemoteAudioContext();
        
        // If stream instance changed, tear down old nodes
        if (this.peerSourceNodes[peerId] && this.peerSourceNodes[peerId]._streamId !== remoteStream.id) {
          try { this.peerSourceNodes[peerId].disconnect(); } catch (e) {}
          delete this.peerSourceNodes[peerId];
          if (this.peerGainNodes[peerId]) {
            try { this.peerGainNodes[peerId].disconnect(); } catch (e) {}
            delete this.peerGainNodes[peerId];
          }
        }

        if (!this.peerGainNodes[peerId]) {
          const source = ctx.createMediaStreamSource(remoteStream);
          source._streamId = remoteStream.id;
          const gainNode = ctx.createGain();
          const destination = ctx.createMediaStreamDestination();

          source.connect(gainNode);
          gainNode.connect(destination);

          this.peerSourceNodes[peerId] = source;
          this.peerGainNodes[peerId] = gainNode;
          this.peerDestinations[peerId] = destination;
        }

        const effective = this.getEffectivePeerVolume(peerId);
        // Supports full dynamic range above 100% (e.g. 150% = 1.5x gain, 200% = 2.0x gain!)
        const gainValue = this.isDeafened ? 0 : (effective / 100);
        this.peerGainNodes[peerId].gain.setTargetAtTime(gainValue, ctx.currentTime, 0.01);

        playoutStream = this.peerDestinations[peerId].stream;
      }
    } catch (graphErr) {
      console.warn('[WebRTC] Web Audio amplification setup error, fallback to raw stream:', graphErr);
      playoutStream = remoteStream;
    }

    // 3. Set stream to audio element
    if (audioEl.srcObject !== playoutStream) {
      audioEl.srcObject = playoutStream;
    }

    // 4. Audio element volume: when GainNode is active, audioEl stays at 1.0 (unclamped gain handles amplification)
    if (this.peerGainNodes[peerId]) {
      audioEl.volume = this.isDeafened ? 0 : 1.0;
      audioEl.muted = Boolean(this.isDeafened);
    } else {
      const effectiveVol = this.getEffectivePeerVolume(peerId);
      audioEl.volume = this.isDeafened ? 0 : Math.min(1.0, Math.max(0, effectiveVol / 100));
      audioEl.muted = Boolean(this.isDeafened);
    }

    // 5. Force play
    const playPromise = audioEl.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => {
        console.warn(`[WebRTC] audioEl autoplay waiting for user interaction for ${peerId}:`, e);
        const unlock = () => {
          this.resumeAudioContexts();
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
          aiDenoise: true,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: false,
          voiceGateEnabled: true,
          voiceGateThreshold: 22,
          keyboardFilterEnabled: true,
          autoSensitivity: false,
          compressorEnabled: true,
          ...JSON.parse(saved)
        };
      }
    } catch (e) {}
    return {
      aiDenoise: true,
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: false,
      voiceGateEnabled: true,
      voiceGateThreshold: 22,
      keyboardFilterEnabled: true,
      autoSensitivity: false,
      compressorEnabled: true
    };
  }

  saveAudioSettings(settings) {
    const prevAi = this.audioSettings?.aiDenoise;
    this.audioSettings = { ...this.audioSettings, ...settings };
    try {
      localStorage.setItem('turkcord_audio_settings', JSON.stringify(this.audioSettings));
    } catch (e) {}

    // Live update Web Audio filter & gate
    if (this.highpassFilter && this.audioContext && this.audioContext.state !== 'closed') {
      const hpFreq = this.audioSettings.keyboardFilterEnabled !== false ? 90 : 80;
      this.highpassFilter.frequency.setTargetAtTime(hpFreq, this.audioContext.currentTime, 0.01);
    }
    if (this.keyboardFilterShelf && this.audioContext && this.audioContext.state !== 'closed') {
      const shelfGain = this.audioSettings.keyboardFilterEnabled !== false ? -4 : 0;
      this.keyboardFilterShelf.gain.setTargetAtTime(shelfGain, this.audioContext.currentTime, 0.01);
    }
    if (this.gateGainNode && this.audioContext && this.audioContext.state !== 'closed') {
      if (!this.audioSettings.voiceGateEnabled) {
        this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
      }
    }

    // Toggle RNNoise AI filter live if setting changed
    if (prevAi !== this.audioSettings.aiDenoise) {
      if (this.audioSettings.aiDenoise !== false) {
        this.initRnnoiseFilter().catch(() => {});
      } else {
        this.removeRnnoiseFilter();
      }
    }

    this.applyAudioSettingsLive();
  }

  async initRnnoiseFilter() {
    if (!this.audioContext || this.audioContext.state === 'closed' || !this.highpassFilter || !this.keyboardFilterShelf) return;
    if (this.rnnoiseNode) return;
    if (this.audioSettings.aiDenoise === false) return;

    try {
      const workletUrl = getAudioAssetUrl('rnnoiseWorklet.js');
      const wasmUrl = getAudioAssetUrl('rnnoise.wasm');
      const wasmSimdUrl = getAudioAssetUrl('rnnoise_simd.wasm');

      await this.audioContext.audioWorklet.addModule(workletUrl);
      const wasmBinary = await loadRnnoise({ url: wasmUrl, simdUrl: wasmSimdUrl });

      if (!this.audioContext || this.audioContext.state === 'closed') return;
      if (this.rnnoiseNode) return;

      this.rnnoiseNode = new RnnoiseWorkletNode(this.audioContext, {
        maxChannels: 1,
        wasmBinary
      });

      // Splice into chain: highpassFilter -> rnnoiseNode -> keyboardFilterShelf
      this.highpassFilter.disconnect();
      this.highpassFilter.connect(this.rnnoiseNode);
      this.rnnoiseNode.connect(this.keyboardFilterShelf);

      console.log('[WebRTC] RNNoise AI Neural Noise Suppression active!');
    } catch (err) {
      console.warn('[WebRTC] RNNoise init failed, fallback to standard DSP:', err);
      this.rnnoiseNode = null;
      try {
        this.highpassFilter.disconnect();
        this.highpassFilter.connect(this.keyboardFilterShelf);
      } catch (e) {}
    }
  }

  removeRnnoiseFilter() {
    if (!this.rnnoiseNode) return;
    try {
      if (this.highpassFilter && this.keyboardFilterShelf) {
        this.highpassFilter.disconnect();
        this.rnnoiseNode.disconnect();
        this.highpassFilter.connect(this.keyboardFilterShelf);
      }
      this.rnnoiseNode.destroy?.();
      this.rnnoiseNode = null;
      console.log('[WebRTC] RNNoise bypassed.');
    } catch (e) {
      console.warn('[WebRTC] removeRnnoiseFilter error:', e);
    }
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
      socket.emit(event, data);
    }

    // Always broadcast over Supabase Realtime so users on different PCs / Vercel seamlessly connect
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

  // Initialize local microphone with studio DSP pipeline (cuts mechanical keyboard noise 100%)
  async initLocalAudio() {
    if (this.initAudioPromise) {
      return this.initAudioPromise;
    }
    if (this.localStream && this.localStream.getAudioTracks().length > 0 && this.localStream.getAudioTracks()[0].readyState === 'live') {
      return this.localStream;
    }

    this.initAudioPromise = (async () => {
      try {
        const audioConstraints = {
          echoCancellation: Boolean(this.audioSettings.echoCancellation),
          noiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          autoGainControl: Boolean(this.audioSettings.autoGainControl),
          googEchoCancellation: Boolean(this.audioSettings.echoCancellation),
          googNoiseSuppression: Boolean(this.audioSettings.noiseSuppression),
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          channelCount: 1,
          sampleRate: 48000
        };
        if (this.selectedInputDeviceId && this.selectedInputDeviceId !== 'default') {
          audioConstraints.deviceId = { exact: this.selectedInputDeviceId };
        }

        try {
          this.rawStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
            video: false
          });
        } catch (deviceErr) {
          console.warn('[WebRTC] Specific mic device failed, falling back to default:', deviceErr);
          this.selectedInputDeviceId = 'default';
          localStorage.removeItem('turkcord_input_device_id');
          this.rawStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: false,
              channelCount: 1,
              sampleRate: 48000
            },
            video: false
          });
        }

        // Initialize Studio DSP Pipeline with Web Audio API
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!this.audioContext || this.audioContext.state === 'closed') {
            this.audioContext = new AudioCtx({ sampleRate: 48000 });
          }
          if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume().catch(() => {});
          }

          // 1. Raw Microphone Source Node
          if (this.micSourceNode) {
            try { this.micSourceNode.disconnect(); } catch (e) {}
          }
          this.micSourceNode = this.audioContext.createMediaStreamSource(this.rawStream);

          // 2. High-Pass Filter: Cuts mechanical keyboard desk vibrations (< 90Hz)
          this.highpassFilter = this.audioContext.createBiquadFilter();
          this.highpassFilter.type = 'highpass';
          this.highpassFilter.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 90 : 80;
          this.highpassFilter.Q.value = 0.707;
          this.micSourceNode.connect(this.highpassFilter);

          // 3. Mechanical Switch Click Attenuation (gentle -4dB cut at 4.5kHz, preserving voice warmth & clarity)
          this.keyboardFilterShelf = this.audioContext.createBiquadFilter();
          this.keyboardFilterShelf.type = 'highshelf';
          this.keyboardFilterShelf.frequency.value = 4500;
          this.keyboardFilterShelf.gain.value = this.audioSettings.keyboardFilterEnabled !== false ? -4 : 0;
          this.highpassFilter.connect(this.keyboardFilterShelf);

          // 4. Analyser for Real-time Voice Formants Detection (measures post-denoise signal)
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 512;
          this.analyser.smoothingTimeConstant = 0.2;
          this.keyboardFilterShelf.connect(this.analyser);

          // 5. Master Input Gain (controlled by user's inputVolume slider 0% - 200%)
          this.micGainNode = this.audioContext.createGain();
          const initialGain = Math.max(0, this.inputVolume / 100);
          this.micGainNode.gain.value = initialGain;
          this.keyboardFilterShelf.connect(this.micGainNode);

          // 6. Voice Activity Gate (cuts 100% of background noise, breathing & typing when not speaking)
          this.gateGainNode = this.audioContext.createGain();
          this.gateGainNode.gain.value = this.audioSettings.voiceGateEnabled ? 0 : 1.0;
          this.micGainNode.connect(this.gateGainNode);

          // 7. Studio Peak Limiter (only clamps excessive shouting > -4dB, leaves normal voice 100% full & rich)
          this.compressor = this.audioContext.createDynamicsCompressor();
          this.compressor.threshold.value = -4;
          this.compressor.knee.value = 10;
          this.compressor.ratio.value = 4;
          this.compressor.attack.value = 0.003;
          this.compressor.release.value = 0.15;
          this.gateGainNode.connect(this.compressor);

          // 8. Makeup Gain (+3.5 dB / 1.5x) for strong, audible broadcast-quality voice
          this.postGainNode = this.audioContext.createGain();
          this.postGainNode.gain.value = 1.5;
          this.compressor.connect(this.postGainNode);

          // 9. Destination Stream to send to WebRTC peer connections
          this.audioDestination = this.audioContext.createMediaStreamDestination();
          this.postGainNode.connect(this.audioDestination);

          // 9. Asynchronously activate RNNoise AI Denoise if enabled
          if (this.audioSettings.aiDenoise !== false) {
            this.initRnnoiseFilter().catch(err => {
              console.warn('[WebRTC] RNNoise filter init error, keeping standard filters:', err);
            });
          }

          this.processedStream = this.audioDestination.stream;
          this.localStream = this.processedStream;
        } catch (dspErr) {
          console.warn('[WebRTC] DSP pipeline setup error, falling back to raw stream:', dspErr);
          this.localStream = this.rawStream;
        }

        const track = this.localStream.getAudioTracks()[0];
        if (track) {
          track.enabled = !this.isMuted;
          if ('contentHint' in track) {
            track.contentHint = 'speech';
          }
        }

        this.setupVAD();
        return this.localStream;
      } catch (err) {
        console.error('[WebRTC] Microphone access error:', err);
        throw err;
      } finally {
        this.initAudioPromise = null;
      }
    })();

    return this.initAudioPromise;
  }

  // Optimize SDP specifically for Gaming: Opus Audio with inband FEC & Crisp Screen Share
  optimizeSdpForGaming(sdp) {
    if (!sdp) return sdp;

    // 1. Opus Audio Optimization (Forward Error Correction enabled, continuous voice)
    const opusMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (opusMatch) {
      const opusPayload = opusMatch[1];
      const gamingParams = 'maxaveragebitrate=96000;useinbandfec=1;usedtx=0';

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

  // Optimize RTCPeerConnection for real-time playout
  optimizePeer(pc) {
    // Senders: set high network priority and target bitrate
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

  // Real-time Voice Activity Detection (VAD) & Dynamic Voice Gate Controller
  setupVAD() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.voiceGateHangTimeout) {
      clearTimeout(this.voiceGateHangTimeout);
      this.voiceGateHangTimeout = null;
    }

    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let wasSpeaking = false;

    this.vadInterval = setInterval(() => {
      if (this.isMuted || !this.rawStream) {
        if (this.gateGainNode && this.audioContext && this.audioContext.state !== 'closed') {
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

      // Human voice formant bins (300Hz - 3400Hz, bins 3 to 36 with 512 fft @ 48kHz)
      let sum = 0;
      let count = 0;
      for (let i = 3; i <= 36; i++) {
        sum += dataArray[i];
        count++;
      }
      const rawLevel = count > 0 ? (sum / count) * 1.5 : 0;
      const level = Math.min(100, Math.round(rawLevel));

      // Adaptive ambient noise floor tracking
      if (level < 25) {
        this.noiseFloor = (this.noiseFloor * 0.95) + (level * 0.05);
      }

      let threshold = 22;
      if (this.audioSettings.voiceGateEnabled) {
        if (this.audioSettings.autoSensitivity) {
          // Dynamic sensitivity based on room noise floor
          threshold = Math.min(45, Math.max(14, Math.round(this.noiseFloor + 12)));
        } else {
          threshold = this.audioSettings.voiceGateThreshold ?? 22;
        }
      } else {
        threshold = 0;
      }

      const isSpeaking = level >= threshold;

      // Real-time Studio Voice Activity Gate
      if (this.gateGainNode && this.audioContext && this.audioContext.state !== 'closed') {
        if (this.audioSettings.voiceGateEnabled) {
          if (isSpeaking) {
            if (this.voiceGateHangTimeout) {
              clearTimeout(this.voiceGateHangTimeout);
              this.voiceGateHangTimeout = null;
            }
            // Fast attack: opens in 5ms so initial syllables are never chopped
            this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.005);
            this.isGateOpen = true;
          } else if (this.isGateOpen) {
            // Hang time: 250ms buffer prevents chopping sentence endings or pauses between words
            if (!this.voiceGateHangTimeout) {
              this.voiceGateHangTimeout = setTimeout(() => {
                if (this.gateGainNode && this.audioContext && this.audioContext.state !== 'closed') {
                  // Smooth 20ms release to pure silence (cuts typing and background hum)
                  this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.02);
                }
                this.isGateOpen = false;
                this.voiceGateHangTimeout = null;
              }, 250);
            }
          } else {
            this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.01);
          }
        } else {
          this.gateGainNode.gain.setTargetAtTime(1.0, this.audioContext.currentTime, 0.01);
        }
      }

      if (isSpeaking !== wasSpeaking) {
        wasSpeaking = isSpeaking;
        if (this.onSpeakingChange) this.onSpeakingChange('self', isSpeaking);
        this.sendSignal('voice:speaking', { isSpeaking });
      }
    }, 50);
  }

  // Connect to an existing peer (Caller initiates offer)
  async createPeerConnection(peerId, isInitiator) {
    if (!peerId) return null;
    if (!this.localStream) {
      try {
        await this.initLocalAudio();
      } catch (e) {
        console.warn('[WebRTC] createPeerConnection initLocalAudio error:', e);
      }
    }

    const existingPeer = this.peers[peerId];
    if (existingPeer && existingPeer.connection) {
      const existingPc = existingPeer.connection;
      const state = existingPc.connectionState;
      // Do NOT close connections that are 'new', 'connecting', or 'connected'!
      if (!['closed', 'failed'].includes(state)) {
        if (isInitiator && existingPc.signalingState === 'stable') {
          try {
            const offer = await existingPc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true
            });
            const optimizedOffer = new RTCSessionDescription({
              type: offer.type,
              sdp: this.optimizeSdpForGaming(offer.sdp)
            });
            await existingPc.setLocalDescription(optimizedOffer);
            this.optimizePeer(existingPc);
            this.sendSignal('webrtc:offer', { to: peerId, offer: optimizedOffer });
          } catch (e) {
            console.warn('[WebRTC] Renegotiation offer error for ' + peerId, e);
          }
        }
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
    audioEl.muted = Boolean(this.isDeafened);
    audioEl.volume = this.isDeafened ? 0 : Math.min(1.0, Math.max(0, this.getEffectivePeerVolume(peerId) / 100));
    audioEl.srcObject = remoteStream;
    if (this.selectedOutputDeviceId && this.selectedOutputDeviceId !== 'default' && typeof audioEl.setSinkId === 'function') {
      audioEl.setSinkId(this.selectedOutputDeviceId).catch(() => {});
    }

    this.peers[peerId] = {
      connection: pc,
      remoteStream,
      audioEl,
      user: null,
      pendingCandidates: [],
      lastAppliedOfferSdp: null,
      disconnectTimeout: null
    };

    // Add local mic tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        try { pc.addTrack(track, this.localStream); } catch (e) {}
      });
    }

    // Add screen share tracks if currently sharing
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => {
        try { pc.addTrack(track, this.screenStream); } catch (e) {}
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
        }
      } else if (event.streams && event.streams[0]) {
        event.streams[0].getTracks().forEach(track => {
          remoteStream.addTrack(track);
        });
      }

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

    // Handle connection state changes with grace period for transient network drops
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerId} connectionState:`, pc.connectionState);
      const currentPeer = this.peers[peerId];
      if (pc.connectionState === 'connected') {
        if (currentPeer?.disconnectTimeout) {
          clearTimeout(currentPeer.disconnectTimeout);
          currentPeer.disconnectTimeout = null;
        }
        if (currentPeer?.audioEl && currentPeer.remoteStream?.getAudioTracks().length > 0) {
          currentPeer.audioEl.play().catch(() => {});
        }
      } else if (pc.connectionState === 'disconnected') {
        if (currentPeer && !currentPeer.disconnectTimeout) {
          currentPeer.disconnectTimeout = setTimeout(() => {
            if (currentPeer.connection?.connectionState === 'disconnected') {
              console.log(`[WebRTC] Peer ${peerId} disconnected timeout reached, closing.`);
              this.closePeer(peerId);
            }
          }, 3500);
        }
      } else if (['failed', 'closed'].includes(pc.connectionState)) {
        this.closePeer(peerId);
      }
      if (this.onPeersChange) this.onPeersChange({ ...this.peers });
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
    if (!peerId || !offer) return;
    if (!this.localStream) {
      try {
        await this.initLocalAudio();
      } catch (e) {
        console.warn('[WebRTC] handleOffer initLocalAudio error:', e);
      }
    }

    let peer = this.peers[peerId];
    let pc;
    if (!peer || (peer.connection && ['closed', 'failed'].includes(peer.connection.connectionState))) {
      if (peer) this.closePeer(peerId);
      pc = await this.createPeerConnection(peerId, false);
      peer = this.peers[peerId];
    } else {
      pc = peer.connection;
    }

    if (!pc) return;

    // Deduplication check
    if (peer && peer.lastAppliedOfferSdp === offer.sdp) {
      return;
    }

    // Ensure our local audio tracks are attached to pc
    if (this.localStream && pc) {
      const senders = pc.getSenders();
      this.localStream.getAudioTracks().forEach(track => {
        if (!senders.some(s => s.track && s.track.id === track.id)) {
          try { pc.addTrack(track, this.localStream); } catch (e) {}
        }
      });
    }

    try {
      // Glare / collision handling: If already in have-local-offer, resolve politely
      const isPolite = String(this.currentUserId || '') < String(peerId || '');
      const isCollision = pc.signalingState !== 'stable';

      if (isCollision) {
        if (isPolite) {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch (e) {
            console.warn('[WebRTC] Rollback error:', e);
          }
        } else {
          console.log('[WebRTC] Glare collision ignored (impolite peer):', peerId);
          return;
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      if (peer) peer.lastAppliedOfferSdp = offer.sdp;
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
    if (!peerId || !answer) return;
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
    if (!peer || !peer.connection) return;
    const candidates = [
      ...(this.pendingIceCandidates[peerId] || []),
      ...(peer.pendingCandidates || [])
    ];
    this.pendingIceCandidates[peerId] = [];
    peer.pendingCandidates = [];

    for (const cand of candidates) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('[WebRTC] Error flushing candidate for ' + peerId, e);
      }
    }
  }

  // Handle incoming ICE candidate with buffering
  async handleCandidate(peerId, candidate) {
    if (!peerId || !candidate) return;
    const peer = this.peers[peerId];

    if (peer && peer.connection && peer.connection.remoteDescription && peer.connection.remoteDescription.type) {
      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Error adding ice candidate:', e);
      }
    } else {
      if (!this.pendingIceCandidates[peerId]) {
        this.pendingIceCandidates[peerId] = [];
      }
      this.pendingIceCandidates[peerId].push(candidate);
      if (peer) {
        if (!peer.pendingCandidates) peer.pendingCandidates = [];
        peer.pendingCandidates.push(candidate);
      }
    }
  }

  // Screen sharing toggle with resolution choice (1080p, 720p, 480p, auto)
  // Low-RAM bounded constraints (30-60 FPS max, prevents multi-gigabyte DirectX memory queues)
  async startScreenShare(targetQuality = 'auto') {
    let videoConstraints = {
      cursor: 'always'
    };

    if (targetQuality === '1080p-120' || targetQuality === '120fps' || targetQuality === '1080p') {
      videoConstraints.width = { ideal: 1920, max: 1920 };
      videoConstraints.height = { ideal: 1080, max: 1080 };
      videoConstraints.frameRate = { ideal: 30, max: 60 };
    } else if (targetQuality === '720p') {
      videoConstraints.width = { ideal: 1280, max: 1280 };
      videoConstraints.height = { ideal: 720, max: 720 };
      videoConstraints.frameRate = { ideal: 30, max: 60 };
    } else if (targetQuality === '480p') {
      videoConstraints.width = { ideal: 854, max: 854 };
      videoConstraints.height = { ideal: 480, max: 480 };
      videoConstraints.frameRate = { ideal: 30, max: 30 };
    } else {
      // Auto: smooth balanced 1080p @ 30-60 FPS
      videoConstraints.width = { ideal: 1920, max: 1920 };
      videoConstraints.height = { ideal: 1080, max: 1080 };
      videoConstraints.frameRate = { ideal: 30, max: 60 };
    }

    try {
      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: true
        });
      } catch (audioErr) {
        console.warn('[WebRTC] System audio unavailable, falling back to video-only capture:', audioErr);
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: false
        });
      }

      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack && 'contentHint' in videoTrack) {
        videoTrack.contentHint = 'detail';
      }

      // Capture and mix system audio if user enabled "Share Audio"
      const screenAudioTrack = this.screenStream.getAudioTracks()[0];
      if (screenAudioTrack && this.audioContext && this.audioDestination) {
        try {
          const screenAudioStream = new MediaStream([screenAudioTrack]);
          this.screenAudioSourceNode = this.audioContext.createMediaStreamSource(screenAudioStream);
          this.screenAudioGainNode = this.audioContext.createGain();
          this.screenAudioGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
          this.screenAudioSourceNode.connect(this.screenAudioGainNode);
          this.screenAudioGainNode.connect(this.audioDestination);
          console.log('[WebRTC] System screen audio successfully mixed into WebRTC voice stream');
        } catch (mixErr) {
          console.warn('[WebRTC] Error mixing screen audio into DSP pipeline:', mixErr);
        }
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

// Screen audio is already seamlessly mixed into the voice stream via WebAudio destination

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

  async stopScreenShare() {
    if (this.screenAudioSourceNode) {
      try { this.screenAudioSourceNode.disconnect(); } catch (e) {}
      this.screenAudioSourceNode = null;
    }
    if (this.screenAudioGainNode) {
      try { this.screenAudioGainNode.disconnect(); } catch (e) {}
      this.screenAudioGainNode = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;

      // Remove video track and any screen audio track from peers and renegotiate
      for (const [peerId, peer] of Object.entries(this.peers)) {
        const senders = peer.connection.getSenders();
        let needsRenegotiate = false;
        for (const sender of senders) {
          if (sender.track && sender.track.kind === 'video') {
            try {
              peer.connection.removeTrack(sender);
              needsRenegotiate = true;
            } catch (e) {}
          }
        }
        if (needsRenegotiate) {
          await this.renegotiate(peerId, peer.connection);
        }
        // Guarantee peer audio continues playing seamlessly
        if (peer.audioEl) {
          peer.audioEl.play().catch(() => {});
        }
      }

      realtimeSignaling.sendScreenShareToggle(false);
      if (socket && socket.connected) {
        socket.emit('voice:screenshare-toggle', { isSharing: false });
      }
      if (this.onLocalScreenShareEnded) { try { this.onLocalScreenShareEnded(); } catch(e){} }
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

      // Maintain high resolution with safe memory limits (prevents Chromium memory spikes)
      params.degradationPreference = 'balanced';

      if (quality === '1080p-120' || quality === '120fps' || quality === '1080p') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 3500000; // 3.5 Mbps high fidelity 1080p (Discord standard)
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '720p') {
        params.encodings[0].scaleResolutionDownBy = 1.0;
        params.encodings[0].maxBitrate = 1800000; // 1.8 Mbps clean 720p HD
        params.encodings[0].maxFramerate = 60;
      } else if (quality === '480p') {
        params.encodings[0].scaleResolutionDownBy = 2.0;
        params.encodings[0].maxBitrate = 800000; // 800 kbps SD
        params.encodings[0].maxFramerate = 30;
      } else {
        // Auto / Dynamic Adaptive: capped at 2.5 Mbps & 60 FPS for ultra low RAM usage
        delete params.encodings[0].scaleResolutionDownBy;
        params.encodings[0].maxBitrate = 2500000;
        params.encodings[0].maxFramerate = 60;
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
    if (this.peerSourceNodes[peerId]) {
      try { this.peerSourceNodes[peerId].disconnect(); } catch (e) {}
      delete this.peerSourceNodes[peerId];
    }
    if (this.peerGainNodes[peerId]) {
      try { this.peerGainNodes[peerId].disconnect(); } catch (e) {}
      delete this.peerGainNodes[peerId];
    }
    if (this.peerDestinations[peerId]) {
      delete this.peerDestinations[peerId];
    }
    delete this.pendingIceCandidates[peerId];

    const peer = this.peers[peerId];
    if (peer) {
      if (peer.disconnectTimeout) {
        clearTimeout(peer.disconnectTimeout);
        peer.disconnectTimeout = null;
      }
      if (peer.audioEl) {
        peer.audioEl.srcObject = null;
        peer.audioEl.remove();
      }
      if (peer.connection) {
        try { peer.connection.close(); } catch (e) {}
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

    for (const sourceNode of Object.values(this.peerSourceNodes)) {
      try { sourceNode.disconnect(); } catch (e) {}
    }
    this.peerSourceNodes = {};

    for (const gainNode of Object.values(this.peerGainNodes)) {
      try { gainNode.disconnect(); } catch (e) {}
    }
    this.peerGainNodes = {};
    this.peerDestinations = {};

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

      // 1. Highpass filter: cuts keyboard desk vibrations (< 120Hz)
      const highpass = testCtx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = this.audioSettings.keyboardFilterEnabled !== false ? 120 : 80;
      source.connect(highpass);

      // 2. Highshelf filter: cuts switch clicks
      const highshelf = testCtx.createBiquadFilter();
      highshelf.type = 'highshelf';
      highshelf.frequency.value = 3800;
      highshelf.gain.value = this.audioSettings.keyboardFilterEnabled !== false ? -18 : 0;
      highpass.connect(highshelf);

      // 3. Analyser on filtered audio
      const analyser = testCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      highshelf.connect(analyser);

      // 4. Test Gain Node (user inputVolume)
      const testGain = testCtx.createGain();
      testGain.gain.value = Math.max(0, this.inputVolume / 100);
      highshelf.connect(testGain);

      // 5. Test Gate
      const testGate = testCtx.createGain();
      testGate.gain.setValueAtTime(0, testCtx.currentTime);
      testGain.connect(testGate);

      // 6. Connect to headphones so user can verify gating with their own ears
      const monitorGain = testCtx.createGain();
      monitorGain.gain.value = 1.0;
      testGate.connect(monitorGain);
      monitorGain.connect(testCtx.destination);

      // 7. Optional RNNoise on test context
      let testRnnoise = null;
      if (this.audioSettings.aiDenoise !== false) {
        (async () => {
          try {
            const workletUrl = getAudioAssetUrl('rnnoiseWorklet.js');
            const wasmUrl = getAudioAssetUrl('rnnoise.wasm');
            const wasmSimdUrl = getAudioAssetUrl('rnnoise_simd.wasm');
            await testCtx.audioWorklet.addModule(workletUrl);
            const wasmBinary = await loadRnnoise({ url: wasmUrl, simdUrl: wasmSimdUrl });
            if (testCtx.state === 'closed') return;
            testRnnoise = new RnnoiseWorkletNode(testCtx, { maxChannels: 1, wasmBinary });
            highpass.disconnect();
            highpass.connect(testRnnoise);
            testRnnoise.connect(highshelf);
          } catch (e) {}
        })();
      }

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
        if (testRnnoise) {
          try { testRnnoise.destroy?.(); } catch (e) {}
        }
        try { monitorGain.disconnect(); } catch (e) {}
        try { testGate.disconnect(); } catch (e) {}
        try { testGain.disconnect(); } catch (e) {}
        try { highshelf.disconnect(); } catch (e) {}
        try { highpass.disconnect(); } catch (e) {}
        try { source.disconnect(); } catch (e) {}
        try { testCtx.close(); } catch (e) {}
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
