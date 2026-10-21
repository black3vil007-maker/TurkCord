import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { 
  ShieldAlert, 
  X, 
  MicOff, 
  Mic, 
  UserMinus, 
  Ban, 
  CheckCircle, 
  Search, 
  Radio, 
  Users, 
  Volume2,
  Trash2
} from 'lucide-react';

export default function AdminPanelModal({
  currentUser,
  onClose,
  allUsers,
  voiceRooms,
  channels,
  onKickUser,
  onToggleMute,
  onTogglePassive
}) {
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState(null);

  // Load all profiles from Supabase
  const loadAllProfiles = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      if (data) setProfiles(data);
    } catch (e) {
      console.warn('Error loading profiles:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllProfiles();

    const channel = supabase
      .channel('admin:profiles-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadAllProfiles();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = profiles.filter(p => {
    const term = search.toLowerCase();
    return (
      p.username?.toLowerCase().includes(term) ||
      p.user_code?.includes(term)
    );
  });

  const getVoiceRoomOfUser = (userId) => {
    for (const [roomId, members] of Object.entries(voiceRooms)) {
      if (members.some(m => m.id === userId)) {
        const roomObj = channels.voice?.find(v => v.id === roomId);
        return { id: roomId, name: roomObj?.name || roomId };
      }
    }
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-3xl bg-[#161b22] border-2 border-amber-500/40 shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-[#30363d] flex items-center justify-between bg-[#0d1117]/80">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-xl shadow">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-black text-white">TurkCord Yönetim Paneli</h2>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-black border border-amber-500/30">
                  SÜPER ADMIN
                </span>
              </div>
              <p className="text-xs text-[#7d8590]">
                Yetkili: <strong className="text-white">aerayyoruk@gmail.com</strong> — Sistem genelinde odadan atma, sessize alma ve hesap dondurma
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats & Search Bar */}
        <div className="p-4 border-b border-[#30363d] flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#161b22]">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-[#7d8590] absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Kullanıcı adı veya 10 haneli ID ara..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-amber-500 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white outline-none"
            />
          </div>

          <div className="flex items-center space-x-4 text-xs font-semibold text-[#8b949e]">
            <div className="flex items-center space-x-1.5">
              <Users className="w-4 h-4 text-indigo-400" />
              <span>Toplam Kayıt: <strong className="text-white">{profiles.length}</strong></span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Çevrimiçi: <strong className="text-emerald-400">{allUsers.length}</strong></span>
            </div>
          </div>
        </div>

        {/* Action Notice */}
        {actionNotice && (
          <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center justify-between">
            <span>{actionNotice}</span>
            <button onClick={() => setActionNotice(null)} className="text-amber-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* User Table / List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {filtered.map((profile) => {
            const isMe = profile.id === currentUser?.id || profile.user_code === currentUser?.user_code;
            const onlineData = allUsers.find(u => u.id === profile.id || u.username === profile.username);
            const isOnline = Boolean(onlineData);
            const userVoice = getVoiceRoomOfUser(profile.id);
            const isPassive = Boolean(profile.is_passive);

            return (
              <div
                key={profile.id}
                className={`p-3.5 rounded-2xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isPassive
                    ? 'bg-rose-950/20 border-rose-500/40'
                    : isOnline
                    ? 'bg-[#1c2420]/50 border-emerald-500/30'
                    : 'bg-[#0d1117] border-[#30363d]'
                }`}
              >
                {/* User Info */}
                <div className="flex items-center space-x-3 truncate">
                  <div className="relative flex-shrink-0">
                    <span className="text-2xl">{profile.avatar || '🎮'}</span>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#161b22] ${
                      isOnline ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-[#484f58]'
                    }`} />
                  </div>

                  <div className="truncate">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm truncate">{profile.username}</span>
                      {isMe && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-black">
                          SEN (ADMIN)
                        </span>
                      )}
                      {isPassive ? (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-black">
                          PASİF (GİRİŞ YASAKLI)
                        </span>
                      ) : isOnline ? (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold">
                          ONLINE
                        </span>
                      ) : null}
                    </div>

                    <div className="text-xs text-[#7d8590] flex items-center space-x-3 mt-0.5 font-mono">
                      <span>ID: {profile.user_code || '------'}</span>
                      {userVoice ? (
                        <span className="text-emerald-400 font-sans font-bold flex items-center space-x-1">
                          <Radio className="w-3 h-3 animate-pulse" />
                          <span>{userVoice.name} odasında</span>
                        </span>
                      ) : (
                        <span className="text-[#8b949e] font-sans">Odalarda Değil</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Admin Actions */}
                {!isMe && (
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    {/* Odadan At */}
                    <button
                      type="button"
                      disabled={!userVoice}
                      onClick={async () => {
                        await onKickUser(profile);
                        setActionNotice(`${profile.username} kullanıcısı ses odasından çıkarıldı.`);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-black border border-amber-500/30 text-xs font-bold transition flex items-center space-x-1 disabled:opacity-30 disabled:pointer-events-none"
                      title={userVoice ? `${userVoice.name} odasından at` : 'Şu an bir odada değil'}
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                      <span>Odadan At</span>
                    </button>

                    {/* Sustur / Sesi Aç */}
                    <button
                      type="button"
                      onClick={async () => {
                        await onToggleMute(profile, onlineData?.isForceMuted);
                        setActionNotice(`${profile.username} için susturma durumu güncellendi.`);
                      }}
                      className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1 border ${
                        onlineData?.isForceMuted
                          ? 'bg-rose-500 text-white border-rose-400 shadow'
                          : 'bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] border-[#30363d]'
                      }`}
                      title={onlineData?.isForceMuted ? 'Sessizlik Kilidini Kaldır' : 'Sistem Genelinde Sustur'}
                    >
                      {onlineData?.isForceMuted ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5 text-rose-400" />}
                      <span>{onlineData?.isForceMuted ? 'Sesi Aç' : 'Sustur'}</span>
                    </button>

                    {/* Pasife Al / Aktife Çevir */}
                    <button
                      type="button"
                      onClick={async () => {
                        await onTogglePassive(profile, isPassive);
                        loadAllProfiles();
                        setActionNotice(
                          isPassive
                            ? `${profile.username} hesabı aktife alındı (artık giriş yapabilir).`
                            : `${profile.username} hesabı pasife alındı (giriş yapamaz, oturumu kapatıldı).`
                        );
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1 border ${
                        isPassive
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow'
                          : 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border-rose-500/40'
                      }`}
                      title={isPassive ? 'Hesabı Tekrar Aktif Et' : 'Hesabı Pasife Al (Giriş Yapamaz)'}
                    >
                      {isPassive ? <CheckCircle className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                      <span>{isPassive ? 'Aktife Al' : 'Pasife Çek'}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between text-xs text-[#7d8590]">
          <span>🛡️ Bu panel yalnızca <strong>aerayyoruk@gmail.com</strong> hesabına görünür.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-white font-bold transition"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
