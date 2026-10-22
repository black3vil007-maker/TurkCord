import React, { useState, useRef } from 'react';
import { X, Camera, Trash2, Check, Copy, User, Sparkles, Sliders } from 'lucide-react';
import UserAvatar from './UserAvatar';
import { copyTextSafely } from '../utils/clipboard';

const EMOJI_AVATARS = [
  '🎮', '⚡', '🚀', '🔥', '👾', '🎯', 
  '🐱', '🦊', '🐉', '🎧', '🕹️', '🍕',
  '👑', '💎', '⚔️', '🛡️', '🏆', '🌟'
];

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
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function EditProfileModal({ currentUser, onClose, onUpdateProfile, onOpenAudioSettings }) {
  const [username, setUsername] = useState(currentUser?.username || '');
  const [avatar, setAvatar] = useState(currentUser?.avatar || '🎮');
  const [copiedId, setCopiedId] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef(null);

  const handleCustomPhoto = async (e) => {
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
      console.warn('Avatar compression error:', err);
      alert('Fotoğraf işlenirken bir hata oluştu.');
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleCopyId = async () => {
    if (!currentUser?.user_code) return;
    const success = await copyTextSafely(currentUser.user_code);
    if (success) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2500);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      alert('Kullanıcı adı boş bırakılamaz!');
      return;
    }

    // "Admin" isim rezervasyonu
    const myEmail = (currentUser?.email || '').toLowerCase().trim();
    const isReserved = ['admin', 'administrator', 'yönetici'].includes(cleanUsername.toLowerCase());
    if (isReserved && myEmail !== 'aerayyoruk@gmail.com') {
      alert("🚫 'Admin' kullanıcı adı yalnızca sistem yöneticisine aittir.");
      return;
    }

    setIsSaving(true);
    try {
      await onUpdateProfile({ username: cleanUsername, avatar });
      onClose();
    } catch (err) {
      console.error('Update profile error:', err);
      alert('Profil güncellenirken hata oluştu.');
    } finally {
      setIsSaving(false);
    }
  };

  const isCustomPhoto = typeof avatar === 'string' && avatar.startsWith('data:image/');

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-md w-full p-6 shadow-2xl relative flex flex-col max-h-[92vh]">
        {/* Kapat Butonu */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-[#7d8590] hover:text-white p-2 rounded-xl hover:bg-[#21262d] transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Başlığı */}
        <div className="flex items-center space-x-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white">Profilini Düzenle</h3>
            <p className="text-xs text-[#7d8590]">Kullanıcı adını, avatarını ve hesabını yönet</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-1 flex-1">
          {/* Avatar Önizleme & Yükleme Kartı */}
          <div className="bg-[#0d1117] p-4 rounded-2xl border border-[#30363d] flex items-center space-x-4 shadow-sm">
            <div className="relative w-16 h-16 rounded-2xl bg-[#161b22] border-2 border-indigo-500/40 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md group">
              <UserAvatar avatar={avatar} className="w-full h-full rounded-2xl" textClassName="text-3xl" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition text-white"
                title="Fotoğraf Yükle"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-black text-white truncate">{username || 'Kullanıcı'}</div>
              <div className="text-[11px] text-[#7d8590] mt-0.5 font-medium">
                {isCustomPhoto ? 'Özel Profil Fotoğrafı' : 'Emoji Avatar Seçili'}
              </div>

              <div className="flex items-center space-x-2 mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCustomPhoto}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition flex items-center space-x-1.5 shadow"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Fotoğraf Yükle</span>
                </button>

                {isCustomPhoto && (
                  <button
                    type="button"
                    onClick={() => setAvatar('🎮')}
                    className="p-1.5 rounded-xl bg-[#21262d] hover:bg-rose-500/20 text-[#7d8590] hover:text-rose-400 border border-[#30363d] text-xs transition"
                    title="Fotoğrafı Kaldır"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Kullanıcı Adı Girişi */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#7d8590] mb-1.5">
              Kullanıcı Adı
            </label>
            <input
              type="text"
              value={username}
              maxLength={24}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Görünecek kullanıcı adınız..."
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 rounded-xl px-4 py-2.5 text-white outline-none text-sm font-semibold transition"
              required
            />
          </div>

          {/* Hazır Emoji Avatar Seçimi */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#7d8590] mb-1.5">
              Veya Hazır Emoji Avatar Seç
            </label>
            <div className="grid grid-cols-6 gap-2 bg-[#0d1117] p-3 rounded-2xl border border-[#30363d]">
              {EMOJI_AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  className={`h-11 rounded-xl text-2xl flex items-center justify-center transition border ${
                    avatar === emoji
                      ? 'bg-indigo-600/30 border-indigo-500 scale-105 shadow'
                      : 'bg-[#161b22] border-transparent hover:bg-[#21262d] hover:border-[#30363d]'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          {/* 10 Haneli Arkadaşlık ID'si Kartı */}
          <div className="bg-[#0d1117] p-3.5 rounded-2xl border border-[#30363d] flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#7d8590]">
                10 Haneli TurkCord ID'niz
              </div>
              <div className="font-mono text-sm font-black text-emerald-400 tracking-wider mt-0.5">
                #{currentUser?.user_code || '------'}
              </div>
              <div className="text-[10px] text-[#7d8590] mt-0.5">
                Arkadaşlarınız bu kod ile size istek gönderebilir
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopyId}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition ${
                copiedId
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'bg-[#21262d] hover:bg-[#30363d] text-white border border-[#30363d]'
              }`}
            >
              {copiedId ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Kopyalandı!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Kopyala</span>
                </>
              )}
            </button>
          </div>

          {/* Alt Butonlar */}
          <div className="flex items-center justify-between pt-3 border-t border-[#30363d]">
            {onOpenAudioSettings && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAudioSettings();
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1 transition"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Ses & Donanım Ayarları</span>
              </button>
            )}

            <div className="flex items-center space-x-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition shadow-md flex items-center space-x-1.5 disabled:opacity-50"
              >
                <Check className="w-4 h-4" />
                <span>{isSaving ? 'Kaydediliyor...' : 'Kaydet'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
