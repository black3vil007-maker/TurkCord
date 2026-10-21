import React, { useState } from 'react';
import { Gamepad2, ArrowRight } from 'lucide-react';

const AVATARS = ['🎮', '⚡', '🚀', '🔥', '👾', '🎯', '🐱', '🦊', '🐉', '🎧', '🕹️', '🍕'];

export default function JoinModal({ onJoin }) {
  const [username, setUsername] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🎮');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    onJoin({ username: username.trim(), avatar: selectedAvatar });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[#161b22] border border-[#30363d] rounded-3xl max-w-md w-full p-7 shadow-2xl relative">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-600/30 text-3xl font-black">
            {selectedAvatar}
          </div>
          <h2 className="text-2xl font-black text-white">
            TurkCord'a Hoş Geldin!
          </h2>
          <p className="text-xs text-[#7d8590] mt-1">
            Arkadaşlarınla sıfır gecikmeyle konuşmaya hemen başla.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase text-[#7d8590] mb-1.5">
              Oyuncu / Kullanıcı Adın
            </label>
            <input
              type="text"
              required
              autoFocus
              placeholder="Örn: Eray, GhostRider, Apex..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-4 py-2.5 text-white outline-none transition text-sm font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-[#7d8590] mb-1.5">
              Avatarını Seç
            </label>
            <div className="grid grid-cols-6 gap-2 bg-[#21262d] p-3 rounded-2xl border border-[#30363d]">
              {AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setSelectedAvatar(emoji)}
                  className={`w-10 h-10 rounded-xl text-2xl flex items-center justify-center transition ${
                    selectedAvatar === emoji
                      ? 'bg-indigo-600 text-white scale-110 shadow-md ring-2 ring-indigo-400'
                      : 'hover:bg-[#30363d]'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!username.trim()}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl flex items-center justify-center space-x-2 transition shadow-md cursor-pointer mt-3 text-sm active:scale-95"
          >
            <span>Hemen Katıl</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
