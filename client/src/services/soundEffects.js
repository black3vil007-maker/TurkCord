// Sound Effects Generator using Web Audio API (Zero latency, pleasant Discord-style chimes)

class SoundEffectsManager {
  constructor() {
    this.ctx = null;
    this.volume = 0.32; // Balanced, non-fatiguing volume
    this.isEnabled = this.loadSetting();
    this.isChatSoundEnabled = this.loadChatSoundSetting();
  }

  loadSetting() {
    try {
      const val = localStorage.getItem('turkcord_sound_effects');
      return val !== 'false';
    } catch (e) {
      return true;
    }
  }

  loadChatSoundSetting() {
    try {
      const val = localStorage.getItem('turkcord_chat_sound_enabled');
      return val !== 'false';
    } catch (e) {
      return true;
    }
  }

  setChatSoundEnabled(enabled) {
    this.isChatSoundEnabled = Boolean(enabled);
    try {
      localStorage.setItem('turkcord_chat_sound_enabled', String(this.isChatSoundEnabled));
    } catch (e) {}
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    try {
      localStorage.setItem('turkcord_sound_effects', String(this.isEnabled));
    } catch (e) {}
  }

  setOutputDevice(deviceId) {
    if (this.ctx && typeof this.ctx.setSinkId === 'function') {
      try {
        this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId).catch(() => {});
      } catch (e) {}
    }
  }

  getAudioContext() {
    if (!this.isEnabled) return null;
    if (!this.ctx || this.ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        try {
          const savedOutput = localStorage.getItem('turkcord_output_device_id');
          if (savedOutput && savedOutput !== 'default' && typeof this.ctx.setSinkId === 'function') {
            this.ctx.setSinkId(savedOutput).catch(() => {});
          }
        } catch (e) {}
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // 1. Odaya Sen Girince (Uplifting Discord-like Join Sound: A4 -> C#5 -> E5)
  playSelfJoin() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [
        { freq: 440.0, time: 0, duration: 0.12 },        // A4
        { freq: 554.37, time: 0.07, duration: 0.14 },    // C#5
        { freq: 659.25, time: 0.15, duration: 0.30 }     // E5
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume * 0.45, now + time + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch (e) {
      console.warn('[Sound] Self join chime error:', e);
    }
  }

  // 2. Odaya Birisi / Arkadaşın Girince (Pleasant Doorbell Alert: D5 -> A5)
  playUserJoined() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [
        { freq: 587.33, time: 0, duration: 0.14 },       // D5
        { freq: 880.00, time: 0.09, duration: 0.35 }     // A5
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume * 0.42, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch (e) {
      console.warn('[Sound] User joined chime error:', e);
    }
  }

  // 3. Odadan Birisi Ayrılınca (Soft descending chime: G5 -> C5)
  playUserLeft() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const notes = [
        { freq: 783.99, time: 0, duration: 0.12 },       // G5
        { freq: 523.25, time: 0.08, duration: 0.24 }     // C5
      ];

      notes.forEach(({ freq, time, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume * 0.32, now + time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch (e) {
      console.warn('[Sound] User left chime error:', e);
    }
  }

  // 4. Sen Odadan Ayrılınca
  playSelfLeave() {
    if (!this.isEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.16);

      gain.gain.setValueAtTime(this.volume * 0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch (e) {
      console.warn('[Sound] Self leave chime error:', e);
    }
  }

  // 5. Metin Mesajı Bildirim Sesi ("Biling!" Discord-Style Chime)
  playMessageChime() {
    if (!this.isEnabled || !this.isChatSoundEnabled) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      // İki tonlu kristal bildirim ("Biling"): 1046Hz (C6) -> 1568Hz (G6)
      const tones = [
        { freq: 1046.5, time: 0, duration: 0.08, vol: 0.38 },
        { freq: 1567.98, time: 0.05, duration: 0.28, vol: 0.45 }
      ];

      tones.forEach(({ freq, time, duration, vol }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);

        gain.gain.setValueAtTime(0, now + time);
        gain.gain.linearRampToValueAtTime(this.volume * vol, now + time + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + time + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + time);
        osc.stop(now + time + duration);
      });
    } catch (e) {
      console.warn('[Sound] Message chime error:', e);
    }
  }
}

export const soundEffects = new SoundEffectsManager();
