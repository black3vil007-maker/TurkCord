import React, { useState, useEffect } from 'react';
import { X, Mic, Volume2, ShieldCheck, Zap, Sliders, Check } from 'lucide-react';
import { webrtc } from '../services/webrtc';

const AVATARS = ['🎮', '⚡', '🚀', '🔥', '👾', '🎯', '🐱', '🦊', '🐉', '🎧', '🕹️', '🍕'];

export default function SettingsModal({ currentUser, onClose, onUpdateUser }) {
  const [username, setUsername] = useState(currentUser?.username || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '🎮');
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    return () => {
      webrtc.stopMicTest();
    };
  }, []);

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
    e.preventDefault();
    if (!username.trim()) return;
    webrtc.stopMicTest();
    onUpdateUser({ username: username.trim(), avatar });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-lg w-full p-6 shadow-2xl relative">
        {/* Kapat Butonu */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-[#7d8590] hover:text-white p-2 rounded-xl hover:bg-[#21262d] transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Başlığı */}
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">
              Kullanıcı & Ses Ayarları
            </h3>
            <p className="text-xs text-[#7d8590]">
              Profilini düzenle ve mikrofonunu anlık test et
            </p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Profil Kartı */}
          <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3.5">
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
                Avatarını Seç
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

          {/* Mikrofon Test Kartı */}
          <div className="bg-[#21262d] p-4 rounded-2xl border border-[#30363d] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold uppercase text-white mb-0.5">
                  Mikrofonunu Test Et
                </label>
                <p className="text-xs text-[#7d8590]">
                  Konuşurken sesini kulaklığından duy ve gecikmeyi izle.
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

            {/* Ses Seviyesi Barı */}
            <div className="w-full bg-[#0d1117] h-3 rounded-full overflow-hidden p-0.5 border border-[#30363d]">
              <div
                className={`h-full rounded-full transition-all duration-75 ${
                  micLevel > 50 ? 'bg-emerald-400' : micLevel > 15 ? 'bg-indigo-500' : 'bg-[#30363d]'
                }`}
                style={{ width: `${Math.min(100, Math.max(isTestingMic ? micLevel : 0, 0))}%` }}
              />
            </div>
          </div>

          {/* WebRTC Ses Özellikleri Bilgisi */}
          <div className="bg-[#0d1117] p-4 rounded-2xl border border-amber-500/30 space-y-2 text-xs text-[#7d8590]">
            <div className="flex items-center justify-between text-white font-bold pb-1 border-b border-[#30363d]">
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
              <span>Örnekleme Frekansı:</span>
              <span className="text-white font-mono font-bold">48.000 Hz Native Mono</span>
            </div>
          </div>

          {/* Alt Butonlar */}
          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
            >
              İptal
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition shadow-md"
            >
              Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
