import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Mic, Volume2, ShieldCheck, Zap, Sliders, Check, 
  VolumeX, SlidersHorizontal, Radio, Sparkles, User, AudioWaveform, Bell,
  Camera, Image as ImageIcon, Trash2, Headphones, Upload, Laptop, Power
} from 'lucide-react';
import { webrtc } from '../services/webrtc';
import { soundEffects } from '../services/soundEffects';
import UserAvatar from './UserAvatar';

const AVATARS = ['🎮', '⚡', '🚀', '🔥', '👾', '🎯', '🐱', '🦊', '🐉', '🎧', '🕹️', '🍕'];

function compressAvatarImage(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');

        // Center square crop
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/webp', 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function SettingsModal({ currentUser, onClose, onUpdateUser, initialTab = 'audio' }) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'audio', 'profile', 'engine'
  const [username, setUsername] = useState(currentUser?.username || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '🎮');
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Master Volume Controls (0% to 200%)
  const [inputVolume, setInputVolume] = useState(() => webrtc.inputVolume ?? 100);
  const [outputVolume, setOutputVolume] = useState(() => webrtc.outputVolume ?? 100);

  // Audio Device Selection
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedInputId, setSelectedInputId] = useState(() => webrtc.selectedInputDeviceId || 'default');
  const [selectedOutputId, setSelectedOutputId] = useState(() => webrtc.selectedOutputDeviceId || 'default');
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false);

  useEffect(() => {
    webrtc.resumeAudioContexts();
    let isMounted = true;
    const fetchDevices = async () => {
      try {
        const { inputs, outputs } = await webrtc.getAudioDevices();
        if (isMounted) {
          setInputDevices(inputs);
          setOutputDevices(outputs);
        }
      } catch (e) {
        console.warn('Failed to load audio devices:', e);
      }
    };
    fetchDevices();

    const handleDeviceChange = () => {
      fetchDevices();
    };
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    }

    return () => {
      isMounted = false;
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      }
    };
  }, []);

  const handleInputChange = (deviceId) => {
    setSelectedInputId(deviceId);
    webrtc.setInputDevice(deviceId);
  };

  const handleOutputChange = (deviceId) => {
    setSelectedOutputId(deviceId);
    webrtc.setOutputDevice(deviceId);
  };

  const handleTestOutput = async () => {
    setIsPlayingTestSound(true);
    await webrtc.testOutputDevice(selectedOutputId);
    setTimeout(() => {
      setIsPlayingTestSound(false);
    }, 600);
  };

  // Windows Startup (Auto-Launch) State
  const [autoLaunch, setAutoLaunch] = useState(() => {
    try {
      return localStorage.getItem('turkcord_auto_launch') === 'true';
    } catch (e) {
      return false;
    }
  });
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      setIsElectron(true);
      if (typeof window.electronAPI.getAutoLaunch === 'function') {
        window.electronAPI.getAutoLaunch().then((enabled) => {
          setAutoLaunch(Boolean(enabled));
          try { localStorage.setItem('turkcord_auto_launch', String(Boolean(enabled))); } catch (e) {}
        }).catch(() => {});
      }
    }
  }, []);

  const handleToggleAutoLaunch = async (enable) => {
    setAutoLaunch(enable);
    try {
      localStorage.setItem('turkcord_auto_launch', String(enable));
    } catch (e) {}

    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.setAutoLaunch === 'function') {
      try {
        const res = await window.electronAPI.setAutoLaunch(enable);
        setAutoLaunch(res);
      } catch (err) {
        console.warn('setAutoLaunch error:', err);
      }
    }
  };

  const avatarFileInputRef = useRef(null);

  // Audio settings state loaded from webrtc
  const [audioSettings, setAudioSettings] = useState(() => webrtc.loadAudioSettings());
  const [soundEnabled, setSoundEnabled] = useState(() => soundEffects.isEnabled);
  const [saveSuccessToast, setSaveSuccessToast] = useState(false);

  useEffect(() => {
    return () => {
      webrtc.stopMicTest();
    };
  }, []);

  const handleInputVolumeChange = (val) => {
    setInputVolume(val);
    webrtc.setInputVolume(val);
  };

  const handleOutputVolumeChange = (val) => {
    setOutputVolume(val);
    webrtc.setOutputVolume(val);
  };

  const handleCustomAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Lütfen geçerli bir görsel dosyası seçin (PNG, JPG, WebP)!');
      return;
    }
    try {
      const dataUrl = await compressAvatarImage(file, 256);
      setAvatar(dataUrl);
    } catch (err) {
      console.warn('Avatar upload error:', err);
      alert('Görsel yüklenirken bir hata oluştu.');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleUpdateAudioSetting = (key, value) => {
    const updated = { ...audioSettings, [key]: value };
    setAudioSettings(updated);
    webrtc.saveAudioSettings(updated);
  };

  const handleToggleMicTest = async () => {
    if (isTestingMic) {
      webrtc.stopMicTest();
      setIsTestingMic(false);
      setMicLevel(0);
    } else {
      const started = await webrtc.startMicTest((level) => {
        setMicLevel(level);
      });
      if (started) {
        setIsTestingMic(true);
      }
    }
  };

  const handleClose = () => {
    webrtc.stopMicTest();
    onClose();
  };

  const handleSave = (e) => {
    e?.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername) return;

    // "admin" kullanıcı adı rezervasyonu: Yalnızca aerayyoruk@gmail.com alabilir
    const myEmail = (currentUser?.email || '').toLowerCase().trim();
    const isReservedAdminName = ['admin', 'administrator', 'yönetici'].includes(cleanUsername.toLowerCase());
    if (isReservedAdminName && myEmail !== 'aerayyoruk@gmail.com') {
      alert("🚫 'Admin' kullanıcı adı sistem yöneticisine (aerayyoruk@gmail.com) rezerve edilmiştir. Lütfen farklı bir kullanıcı adı seçin.");
      return;
    }

    webrtc.stopMicTest();
    webrtc.saveAudioSettings(audioSettings);
    webrtc.setInputVolume(inputVolume);
    webrtc.setOutputVolume(outputVolume);
    onUpdateUser({ username: cleanUsername, avatar });
    setSaveSuccessToast(true);
    setTimeout(() => {
      onClose();
    }, 450);
  };

  const threshold = audioSettings.voiceGateThreshold ?? 22;
  const isSpeakingLive = micLevel >= threshold;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-xl w-full p-6 shadow-2xl relative flex flex-col max-h-[92vh]">
        {/* Başarı Bildirimi */}
        {saveSuccessToast && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-2xl flex items-center space-x-2 z-50 animate-in fade-in zoom-in-95">
            <Check className="w-4 h-4" />
            <span>Ayarlarınız başarıyla kaydedildi!</span>
          </div>
        )}

        {/* Kapat Butonu */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-[#7d8590] hover:text-white p-2 rounded-xl hover:bg-[#21262d] transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Başlığı */}
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-black text-white">
                Ayarlar & Donanım
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold">
                v1.0.14
              </span>
            </div>
            <p className="text-xs text-[#7d8590]">
              Ses filtreleri, klavye engelleyici ve profil kontrolü
            </p>
          </div>
        </div>

        {/* Sekme Butonları */}
        <div className="flex space-x-1.5 bg-[#0d1117] p-1.5 rounded-2xl border border-[#30363d] mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'audio'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Ses & Donanım</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'profile'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profil</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('system')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'system'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Laptop className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sistem & Başlatma</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 ${
              activeTab === 'engine'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>eSports</span>
          </button>
        </div>

        {/* Sekme İçerikleri */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* TAB 1: SES AYARLARI */}
          {activeTab === 'audio' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Giriş & Çıkış Aygıtı Seçimi (Mikrofon & Hoparlör / Kulaklık) */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#30363d]/70 pb-2.5">
                  <div className="flex items-center space-x-2">
                    <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wide">Ses Donanımı Aygıtları</span>
                  </div>
                  <span className="text-[11px] text-[#7d8590]">Ayrı Giriş & Çıkış</span>
                </div>

                {/* Mikrofon Giriş Aygıtı */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-[#e6edf3] flex items-center space-x-1.5">
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Giriş Aygıtı (Mikrofon)</span>
                    </label>
                    {inputDevices.length > 0 && (
                      <span className="text-[10px] text-emerald-400 font-mono">
                        {inputDevices.length} Aygıt Aktif
                      </span>
                    )}
                  </div>
                  <select
                    value={selectedInputId}
                    onChange={(e) => handleInputChange(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-medium"
                  >
                    <option value="default">Varsayılan Sistem Mikrofonu</option>
                    {inputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Hoparlör / Kulaklık Çıkış Aygıtı */}
                <div className="pt-2 border-t border-[#30363d]/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-[#e6edf3] flex items-center space-x-1.5">
                      <Headphones className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Çıkış Aygıtı (Hoparlör / Kulaklık)</span>
                    </label>
                    <button
                      type="button"
                      onClick={handleTestOutput}
                      disabled={isPlayingTestSound}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 active:scale-95 transition flex items-center space-x-1"
                      title="Seçili hoparlör veya kulaklıktan melodik test sesi çal"
                    >
                      <Volume2 className={`w-3 h-3 ${isPlayingTestSound ? 'animate-bounce text-indigo-400' : ''}`} />
                      <span>{isPlayingTestSound ? 'Çalıyor...' : 'Test Sesi Çal'}</span>
                    </button>
                  </div>
                  <select
                    value={selectedOutputId}
                    onChange={(e) => handleOutputChange(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                  >
                    <option value="default">Varsayılan Sistem Çıkışı</option>
                    {outputDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Giriş & Çıkış Ses Düzeyleri (Master Sliders) */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-4 shadow-sm">
                {/* Mikrofon Giriş Sesi */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <Mic className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wide">Mikrofon Giriş Ses Seviyesi</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {[50, 100, 150, 200].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleInputVolumeChange(v)}
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded transition ${
                            inputVolume === v
                              ? 'bg-emerald-500 text-black'
                              : 'bg-[#0d1117] text-[#8b949e] hover:text-white'
                          }`}
                        >
                          %{v}
                        </button>
                      ))}
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 ml-1">
                        %{inputVolume}
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    step="5"
                    value={inputVolume}
                    onChange={(e) => handleInputVolumeChange(Number(e.target.value))}
                    className="w-full h-2 bg-[#0d1117] rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <div className="flex justify-between text-[10px] text-[#7d8590] mt-1 font-medium">
                    <span>%0 (Sessiz)</span>
                    <span>%100 (Varsayılan)</span>
                    <span>%200 (Yüksek Kazanç)</span>
                  </div>
                </div>

                {/* Kulaklık / Hoparlör Çıkış Sesi */}
                <div className="pt-3 border-t border-[#30363d]/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <Headphones className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wide">Kulaklık / Hoparlör Çıkış Seviyesi</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      {[50, 100, 150, 200].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleOutputVolumeChange(v)}
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded transition ${
                            outputVolume === v
                              ? 'bg-indigo-600 text-white'
                              : 'bg-[#0d1117] text-[#8b949e] hover:text-white'
                          }`}
                        >
                          %{v}
                        </button>
                      ))}
                      <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 ml-1">
                        %{outputVolume}
                      </span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    step="5"
                    value={outputVolume}
                    onChange={(e) => handleOutputVolumeChange(Number(e.target.value))}
                    className="w-full h-2 bg-[#0d1117] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <div className="flex justify-between text-[10px] text-[#7d8590] mt-1 font-medium">
                    <span>%0 (Sessiz)</span>
                    <span>%100 (Varsayılan)</span>
                    <span>%200 (Güçlendirilmiş)</span>
                  </div>
                </div>
              </div>

              {/* Yapay Zeka (AI) Gürültü Engelleme (RNNoise Neural Network) */}
              <div className="bg-gradient-to-r from-[#131d2e] via-[#161f38] to-[#121826] p-4 rounded-2xl border-2 border-indigo-500/40 space-y-2 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-start space-x-3 pr-2">
                    <div className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold flex-shrink-0 mt-0.5 shadow-sm">
                      <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-white flex items-center space-x-2 uppercase tracking-wide">
                        <span>Yapay Zeka (AI) Gürültü Engelleme</span>
                        <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-extrabold border border-emerald-500/30">
                          ÖNERİLEN
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8b949e] mt-1 leading-relaxed">
                        Telefon sesleri, çekirdek/cips atıştırma, mekanik klavye/fare tıklaması ve oda uğultularını derin öğrenme (RNNoise AI) ile mikrofondan %100 siler. Yalnızca senin sesini karşıya iletir.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer flex-shrink-0 ml-2">
                    <input
                      type="checkbox"
                      checked={audioSettings.aiDenoise !== false}
                      onChange={(e) => handleUpdateAudioSetting('aiDenoise', e.target.checked)}
                      className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              {/* Mikrofon Test Kartı */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold uppercase text-white mb-0.5">
                      Mikrofon Testi & Anlık Dinleme
                    </label>
                    <p className="text-xs text-[#7d8590]">
                      Konuşurken sesini duy, arka plan gürültüsünü test et.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleMicTest}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm ${
                      isTestingMic
                        ? 'bg-rose-500 hover:bg-rose-600 text-white'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isTestingMic ? 'Testi Durdur' : 'Hadi Kontrol Edelim'}
                  </button>
                </div>

                {/* Ses Seviyesi Barı & Eşik Göstergesi */}
                <div className="relative pt-1">
                  <div className="w-full bg-[#0d1117] h-4 rounded-full overflow-hidden p-0.5 border border-[#30363d] relative">
                    <div
                      className={`h-full rounded-full transition-all duration-75 ${
                        !isTestingMic
                          ? 'bg-[#30363d]'
                          : isSpeakingLive
                          ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.5)]'
                          : 'bg-amber-500/70'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(isTestingMic ? micLevel : 0, 0))}%` }}
                    />

                    {/* Eşik Değeri Çizgisi */}
                    {audioSettings.voiceGateEnabled && (
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-white shadow-md z-10 pointer-events-none"
                        style={{ left: `${threshold}%` }}
                        title={`Ses Eşiği: %${threshold}`}
                      />
                    )}
                  </div>

                  {isTestingMic && (
                    <div className="flex items-center justify-between text-[11px] font-semibold mt-2">
                      <span className={isSpeakingLive ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                        {isSpeakingLive
                          ? '🟢 Ses İletiliyor (Mikrofon Açık)'
                          : '🟡 Klavye / Arka Ses Engellendi (Sessiz)'}
                      </span>
                      <span className="text-[#7d8590] font-mono">
                        Seviye: %{micLevel}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Ses Giriş Hassasiyeti (Voice Gate / Klavye Engelleyici) */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-bold uppercase text-white mb-0.5">
                      Giriş Hassasiyeti (Voice Gate)
                    </label>
                    <p className="text-xs text-[#7d8590]">
                      Mekanik klavye tıklamalarını ve nefes seslerini engeller.
                    </p>
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={audioSettings.voiceGateEnabled}
                      onChange={(e) => handleUpdateAudioSetting('voiceGateEnabled', e.target.checked)}
                      className="rounded accent-indigo-600 w-4 h-4 cursor-pointer"
                    />
                    <span className="text-xs font-bold text-white">Aktif</span>
                  </label>
                </div>

                {audioSettings.voiceGateEnabled && (
                  <div className="space-y-3 pt-1">
                    {/* Otomatik / Manuel Seçimi */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#30363d]/50">
                      <div>
                        <div className="text-xs font-bold text-white">Giriş Hassasiyetini Otomatik Belirle</div>
                        <div className="text-[10px] text-[#7d8590]">Oda sessizliği ve klavye sesine göre eşiği anlık ayarlar.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(audioSettings.autoSensitivity)}
                        onChange={(e) => handleUpdateAudioSetting('autoSensitivity', e.target.checked)}
                        className="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
                      />
                    </div>

                    {!audioSettings.autoSensitivity && (
                      <>
                        {/* Hazır Seviye Butonları */}
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => handleUpdateAudioSetting('voiceGateThreshold', 14)}
                            className={`py-1.5 px-2 rounded-xl text-[11px] font-bold border transition ${
                              threshold === 14
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                                : 'bg-[#0d1117] text-[#7d8590] hover:text-white border-[#30363d]'
                            }`}
                          >
                            Hassas (%14)
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateAudioSetting('voiceGateThreshold', 22)}
                            className={`py-1.5 px-2 rounded-xl text-[11px] font-bold border transition ${
                              threshold === 22
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                                : 'bg-[#0d1117] text-[#7d8590] hover:text-white border-[#30363d]'
                            }`}
                          >
                            Dengeli (%22) ⭐
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateAudioSetting('voiceGateThreshold', 32)}
                            className={`py-1.5 px-2 rounded-xl text-[11px] font-bold border transition ${
                              threshold === 32
                                ? 'bg-indigo-600 text-white border-indigo-500 shadow'
                                : 'bg-[#0d1117] text-[#7d8590] hover:text-white border-[#30363d]'
                            }`}
                          >
                            Mekanik Tuş (%32)
                          </button>
                        </div>

                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#7d8590] font-medium">
                            Klavye & Gürültü Eşiği
                          </span>
                          <span className="font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                            %{threshold}
                          </span>
                        </div>

                        <input
                          type="range"
                          min="5"
                          max="60"
                          step="1"
                          value={threshold}
                          onChange={(e) => handleUpdateAudioSetting('voiceGateThreshold', Number(e.target.value))}
                          className="w-full h-2 bg-[#0d1117] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                        />
                      </>
                    )}

                    <p className="text-[11px] text-[#7d8590] leading-relaxed">
                      💡 <strong>Nasıl Çalışır?</strong> Test butonuna basıp çekirdek çitleyin veya klavyede yazı yazın. Çubuk beyaz çizginin altında kaldığı sürece karşı tarafa <strong>sıfır ses</strong> gider! Konuştuğunuzda çizginin üzerine çıkarak ses anında ve pürüzsüz iletilir.
                    </p>
                  </div>
                )}
              </div>

              {/* Donanım / Tarayıcı Filtreleri */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3">
                <label className="block text-xs font-bold uppercase text-white mb-1">
                  Akıllı Ses & Donanım Filtreleri
                </label>

                {/* Mekanik Klavye ve Masa Titreşim Filtresi (High-pass) */}
                <div className="flex items-center justify-between py-2 border-b border-[#30363d]/60">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span>Mekanik Klavye Filtresi (110Hz DSP)</span>
                    </div>
                    <p className="text-[11px] text-[#7d8590] mt-0.5">
                      Switch'lerin vurma ve masa titreşim seslerini donanımsal frekans filtresiyle siler.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={audioSettings.keyboardFilterEnabled !== false}
                    onChange={(e) => handleUpdateAudioSetting('keyboardFilterEnabled', e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                {/* Gürültü Engelleme */}
                <div className="flex items-center justify-between py-2 border-b border-[#30363d]/60">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      <span>Gürültü Engelleme (Noise Suppression)</span>
                    </div>
                    <p className="text-[11px] text-[#7d8590] mt-0.5">
                      Klavye tuşları, kasa fanı ve oda uğultularını DSP algoritmasıyla siler.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(audioSettings.noiseSuppression)}
                    onChange={(e) => handleUpdateAudioSetting('noiseSuppression', e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                {/* Yankı Engelleme */}
                <div className="flex items-center justify-between py-2 border-b border-[#30363d]/60">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <Volume2 className="w-4 h-4 text-indigo-400" />
                      <span>Yankı Engelleme (Echo Cancellation)</span>
                    </div>
                    <p className="text-[11px] text-[#7d8590] mt-0.5">
                      Hoparlör sesinin mikrofona geri kaçmasını engeller.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(audioSettings.echoCancellation)}
                    onChange={(e) => handleUpdateAudioSetting('echoCancellation', e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                {/* Otomatik Kazanç */}
                <div className="flex items-center justify-between py-1">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <AudioWaveform className="w-4 h-4 text-amber-400" />
                      <span>Otomatik Kazanç (Auto Gain Control)</span>
                    </div>
                    <p className="text-[11px] text-[#7d8590] mt-0.5">
                      Sesinizi otomatik dengeler (Oyun içi netlik için kapalı önerilir).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(audioSettings.autoGainControl)}
                    onChange={(e) => handleUpdateAudioSetting('autoGainControl', e.target.checked)}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Oda Bildirim & Giriş/Çıkış Sesleri */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <Bell className="w-4 h-4 text-emerald-400" />
                      <span>Oda Bildirim Sesleri (Chime)</span>
                    </div>
                    <p className="text-[11px] text-[#7d8590] mt-0.5">
                      Odaya sen girdiğinde veya bir arkadaşın odaya katıldığında özel bildirim sesi çalar.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setSoundEnabled(val);
                      soundEffects.setEnabled(val);
                      if (val) soundEffects.playUserJoined();
                    }}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                {soundEnabled && (
                  <div className="pt-2 border-t border-[#30363d]/60 flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => soundEffects.playSelfJoin()}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-[#0d1117] hover:bg-[#161b22] text-[#c9d1d9] hover:text-white border border-[#30363d] text-[11px] font-bold transition flex items-center justify-center space-x-1.5 shadow-sm"
                    >
                      <span>🎵 Odaya Giriş Sesini Dinle</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => soundEffects.playUserJoined()}
                      className="flex-1 py-1.5 px-3 rounded-xl bg-[#0d1117] hover:bg-[#161b22] text-[#c9d1d9] hover:text-white border border-[#30363d] text-[11px] font-bold transition flex items-center justify-center space-x-1.5 shadow-sm"
                    >
                      <span>🔔 Biri Katılma Sesini Dinle</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PROFİL AYARLARI */}
          {activeTab === 'profile' && (
            <div className="bg-[#21262d] p-5 rounded-2xl border border-[#30363d] space-y-4 animate-in fade-in duration-150">
              {/* Profil Önizleme Kartı */}
              <div className="flex items-center space-x-4 p-3 bg-[#0d1117] rounded-2xl border border-[#30363d]">
                <div className="w-16 h-16 rounded-2xl bg-[#161b22] border-2 border-indigo-500/40 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-lg relative group">
                  <UserAvatar avatar={avatar} className="w-full h-full rounded-2xl" textClassName="text-3xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-extrabold text-sm truncate">
                    {username || 'Kullanıcı'}
                  </div>
                  <div className="text-xs text-[#7d8590] mt-0.5 font-medium">
                    {typeof avatar === 'string' && avatar.startsWith('data:image/')
                      ? 'Özel Profil Fotoğrafı Yüklendi'
                      : 'Emoji Avatar Seçili'}
                  </div>

                  <div className="flex items-center space-x-2 mt-2">
                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCustomAvatarUpload}
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => avatarFileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Fotoğraf Yükle</span>
                    </button>

                    {typeof avatar === 'string' && avatar.startsWith('data:image/') && (
                      <button
                        type="button"
                        onClick={() => setAvatar('🎮')}
                        className="px-2.5 py-1.5 rounded-xl bg-[#21262d] hover:bg-rose-500/20 text-[#7d8590] hover:text-rose-400 border border-[#30363d] text-xs font-bold transition flex items-center space-x-1"
                        title="Fotoğrafı Kaldır ve Emojiye Dön"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Kaldır</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#7d8590] mb-1.5">
                  Kullanıcı Adı
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-4 py-2.5 text-white outline-none text-sm transition font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-[#7d8590] mb-1.5">
                  Veya Hazır Emoji Avatar Seç
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {AVATARS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setAvatar(em)}
                      className={`h-11 rounded-xl text-2xl flex items-center justify-center transition-all ${
                        avatar === em
                          ? 'bg-indigo-600 text-white scale-105 shadow-md ring-2 ring-indigo-400'
                          : 'bg-[#0d1117] hover:bg-[#161b22] border border-[#30363d]'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SİSTEM & BAŞLANGIÇ AYARLARI */}
          {activeTab === 'system' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Windows ile Başlatma Seçeneği */}
              <div className="bg-[#21262d] p-5 rounded-2xl border border-[#30363d] space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <label className="text-sm font-bold text-white flex items-center space-x-2">
                      <Laptop className="w-4 h-4 text-emerald-400" />
                      <span>PC Açılışında Otomatik Başlat</span>
                    </label>
                    <p className="text-xs text-[#7d8590] mt-1 leading-relaxed">
                      Bilgisayarınızı açtığınızda TurkCord arka planda hazır olarak otomatik açılsın.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={autoLaunch}
                      onChange={(e) => handleToggleAutoLaunch(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-[#0d1117] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500 border border-[#30363d]"></div>
                  </label>
                </div>

                <div className="pt-3 border-t border-[#30363d]/60 text-[11px] text-[#7d8590] flex items-center justify-between">
                  <span>Açılış Durumu:</span>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded-md ${
                    autoLaunch ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-[#0d1117] text-[#7d8590]'
                  }`}>
                    {autoLaunch ? '🟢 PC Açıldığında Otomatik Açılacak' : '⚪ Kapalı (Manuel Başlatma)'}
                  </span>
                </div>
              </div>

              {/* Bilgisayar & Uygulama Bilgisi */}
              <div className="bg-[#0d1117] p-4 rounded-2xl border border-[#30363d] space-y-2.5 text-xs text-[#7d8590]">
                <div className="flex items-center justify-between">
                  <span>Çalışma Modu:</span>
                  <span className="text-white font-bold">{isElectron ? 'TurkCord Masaüstü (Native App)' : 'Web Tarayıcı Modu'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Düşük Kaynak Tüketimi (Gaming):</span>
                  <span className="text-emerald-400 font-bold">Ultra Düşük CPU & RAM Önceliği Aktif</span>
                </div>
                {!isElectron && (
                  <p className="text-[10px] text-amber-400/80 pt-1 border-t border-[#30363d]/50">
                    ℹ️ PC açılışında otomatik başlatma ayarı TurkCord Masaüstü (.exe) uygulamasında sistem başlangıcına kaydedilir.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: ESPORTS MOTORU BİLGİSİ */}
          {activeTab === 'engine' && (
            <div className="bg-[#0d1117] p-4 rounded-2xl border border-amber-500/30 space-y-2.5 text-xs text-[#7d8590] animate-in fade-in duration-150">
              <div className="flex items-center justify-between text-white font-bold pb-2 border-b border-[#30363d]">
                <div className="flex items-center space-x-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-400 font-black">eSports Ultra Düşük Gecikme Motoru</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  Aktif
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Paketleme Gecikmesi (PTime):</span>
                <span className="text-white font-mono font-bold">10 ms (Standart 40ms yerine)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Jitter Buffer Playout:</span>
                <span className="text-emerald-400 font-mono font-bold">0 ms (Doğrudan Donanım Çıkışı)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Opus Gaming Codec:</span>
                <span className="text-white font-mono font-bold">64 Kbps CBR + Donanım FEC</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Ekran Paylaşımı Bant Genişliği:</span>
                <span className="text-white font-mono font-bold">8.000 Kbps (8 Mbps) FHD 60 FPS</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Örnekleme Frekansı:</span>
                <span className="text-white font-mono font-bold">48.000 Hz Native Mono</span>
              </div>
            </div>
          )}
        </div>

        {/* Alt Butonlar */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-[#30363d] mt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center space-x-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Kaydet & Kapat</span>
          </button>
        </div>
      </div>
    </div>
  );
}
