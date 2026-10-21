import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Mic, Volume2, ShieldCheck, Zap, Sliders, Check, 
  VolumeX, SlidersHorizontal, Radio, Sparkles, User, AudioWaveform, Bell,
  Camera, Image as ImageIcon, Trash2, Headphones, Upload
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

export default function SettingsModal({ currentUser, onClose, onUpdateUser }) {
  const [activeTab, setActiveTab] = useState('audio'); // 'audio', 'profile', 'engine'
  const [username, setUsername] = useState(currentUser?.username || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '🎮');
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Master Volume Controls (0% to 200%)
  const [inputVolume, setInputVolume] = useState(() => webrtc.inputVolume ?? 100);
  const [outputVolume, setOutputVolume] = useState(() => webrtc.outputVolume ?? 100);

  const avatarFileInputRef = useRef(null);

  // Audio settings state loaded from webrtc
  const [audioSettings, setAudioSettings] = useState(() => webrtc.loadAudioSettings());
  const [soundEnabled, setSoundEnabled] = useState(() => soundEffects.isEnabled);

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
    onUpdateUser({ username: cleanUsername, avatar });
    onClose();
  };

  const threshold = audioSettings.voiceGateThreshold ?? 22;
  const isSpeakingLive = micLevel >= threshold;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-xl w-full p-6 shadow-2xl relative flex flex-col max-h-[92vh]">
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
            <h3 className="text-lg font-black text-white">
              Ayarlar & Donanım
            </h3>
            <p className="text-xs text-[#7d8590]">
              Ses filtreleri, klavye engelleyici ve profil kontrolü
            </p>
          </div>
        </div>

        {/* Sekme Butonları */}
        <div className="flex space-x-2 bg-[#0d1117] p-1.5 rounded-2xl border border-[#30363d] mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              activeTab === 'audio'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>Ses & Gürültü Filtresi</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              activeTab === 'profile'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Kullanıcı Profili</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('engine')}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 ${
              activeTab === 'engine'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-[#7d8590] hover:text-white hover:bg-[#161b22]'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>eSports Motoru</span>
          </button>
        </div>

        {/* Sekme İçerikleri */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* TAB 1: SES AYARLARI */}
          {activeTab === 'audio' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Giriş & Çıkış Ses Düzeyleri (Master Sliders) */}
              <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-4 shadow-sm">
                {/* Mikrofon Giriş Sesi */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <Mic className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-white uppercase tracking-wide">Mikrofon Giriş Ses Seviyesi</span>
                    </div>
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      %{inputVolume}
                    </span>
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
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      %{outputVolume}
                    </span>
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

                    <p className="text-[11px] text-[#7d8590] leading-relaxed">
                      💡 <strong>Nasıl Çalışır?</strong> Test butonuna basıp klavyenizde yazı yazın. Çubuk bu beyaz çizginin altında kaldığı sürece karşı tarafa <strong>sıfır ses</strong> gider! Konuştuğunuzda ise çizginin üzerine çıkarak ses anında iletilir.
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

          {/* TAB 3: ESPORTS MOTORU BİLGİSİ */}
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
