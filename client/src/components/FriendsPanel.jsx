import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { 
  UserPlus, 
  Users, 
  Check, 
  X, 
  Volume2, 
  PhoneCall, 
  Clock, 
  Copy,
  Radio,
  Sparkles
} from 'lucide-react';

export default function FriendsPanel({
  currentUser,
  activeVoiceChannel,
  channels,
  allUsers,
  onJoinRoom
}) {
  const [friends, setFriends] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [searchCode, setSearchCode] = useState('');
  const [searchStatus, setSearchStatus] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('list'); // 'list', 'pending', 'add'

  const myUserCode = currentUser?.user_code || (
    currentUser?.id ? Math.abs(hashCode(currentUser.id)).toString().padStart(10, '0').slice(0, 10) : '--------'
  );

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  const handleCopyId = () => {
    navigator.clipboard.writeText(myUserCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Load friendships
  const loadFriendships = async () => {
    if (!currentUser?.id) return;

    try {
      // 1. Get accepted friendships
      const { data: acceptedData } = await supabase
        .from('friendships')
        .select(`
          id,
          user_id,
          friend_id,
          status,
          user:profiles!friendships_user_id_fkey(id, username, avatar, user_code),
          friend:profiles!friendships_friend_id_fkey(id, username, avatar, user_code)
        `)
        .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
        .eq('status', 'accepted');

      if (acceptedData) {
        const formatted = acceptedData.map((f) => {
          const isFriendSender = f.user_id === currentUser.id;
          return {
            friendshipId: f.id,
            profile: isFriendSender ? f.friend : f.user
          };
        }).filter(f => f.profile);
        setFriends(formatted);
      }

      // 2. Get incoming pending requests
      const { data: pendingData } = await supabase
        .from('friendships')
        .select(`
          id,
          user_id,
          status,
          user:profiles!friendships_user_id_fkey(id, username, avatar, user_code)
        `)
        .eq('friend_id', currentUser.id)
        .eq('status', 'pending');

      if (pendingData) {
        setPendingRequests(pendingData);
      }
    } catch (err) {
      console.warn('[Friends] Error loading friendships:', err);
    }
  };

  useEffect(() => {
    loadFriendships();

    const channel = supabase
      .channel('public:friendships')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
        loadFriendships();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // Send friend request via 10-digit ID or username
  const handleSendRequest = async (e) => {
    e.preventDefault();
    setSearchStatus({ type: '', text: '' });

    const target = searchCode.trim();
    if (!target) return;

    if (target === myUserCode || target.toLowerCase() === currentUser?.username?.toLowerCase()) {
      setSearchStatus({ type: 'error', text: 'Kendinize arkadaşlık isteği gönderemezsiniz!' });
      return;
    }

    setLoading(true);

    try {
      // 1. Try finding by user_code, or username
      let { data: targetProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, username, user_code')
        .or(`user_code.eq.${target},username.ilike.${target}`)
        .single();

      if (profileErr || !targetProfile) {
        setSearchStatus({ type: 'error', text: `ID / Kullanıcı adı (${target}) bulunamadı. Lütfen 10 haneli ID'yi kontrol edin.` });
        setLoading(false);
        return;
      }

      // 2. Send friend request
      const { error: insertErr } = await supabase
        .from('friendships')
        .insert({
          user_id: currentUser.id,
          friend_id: targetProfile.id,
          status: 'pending'
        });

      if (insertErr) {
        if (insertErr.code === '23505') {
          setSearchStatus({ type: 'error', text: 'Bu kullanıcıyla zaten arkadaşsınız veya bekleyen bir istek var.' });
        } else {
          setSearchStatus({ type: 'error', text: insertErr.message });
        }
      } else {
        setSearchStatus({ type: 'success', text: `Arkadaşlık isteği ${targetProfile.username} kullanıcısına gönderildi! 🎉` });
        setSearchCode('');
      }
    } catch (err) {
      setSearchStatus({ type: 'error', text: 'İstek gönderilirken hata oluştu.' });
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptRequest = async (friendshipId) => {
    await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);

    loadFriendships();
  };

  const handleRejectRequest = async (friendshipId) => {
    await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    loadFriendships();
  };

  const handleInviteToRoom = async (friendProfileId) => {
    if (!activeVoiceChannel) {
      alert('Önce bir ses odasına katılmalısınız!');
      return;
    }

    const currentRoom = channels.voice?.find(v => v.id === activeVoiceChannel);
    const roomName = currentRoom?.name || 'Ses Odası';

    const { error } = await supabase
      .from('room_invites')
      .insert({
        from_user_id: currentUser.id,
        to_user_id: friendProfileId,
        room_id: activeVoiceChannel,
        room_name: roomName,
        status: 'pending'
      });

    if (!error) {
      alert(`Oda daveti gönderildi! 🎮`);
    } else {
      alert('Davet gönderilemedi: ' + error.message);
    }
  };

  return (
    <div className="space-y-3 pt-1">
      {/* 10 Haneli Kullanıcı ID Kartı */}
      <div className="p-3 rounded-2xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
            Senin 10 Haneli ID'n
          </div>
          <div className="text-base font-black text-white font-mono tracking-widest mt-0.5">
            {myUserCode}
          </div>
        </div>

        <button
          onClick={handleCopyId}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 ${
            copied
              ? 'bg-emerald-500 text-black'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow'
          }`}
          title="ID Kopyala"
        >
          {copied ? (
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

      {/* Sub Tabs: Arkadaşlarım | İstekler | Ekle */}
      <div className="flex rounded-xl bg-[#0d1117] p-1 border border-[#30363d] text-xs font-bold">
        <button
          onClick={() => setActiveSubTab('list')}
          className={`flex-1 py-1.5 rounded-lg transition ${
            activeSubTab === 'list' ? 'bg-[#21262d] text-white shadow' : 'text-[#7d8590] hover:text-white'
          }`}
        >
          Arkadaşlar ({friends.length})
        </button>

        <button
          onClick={() => setActiveSubTab('pending')}
          className={`flex-1 py-1.5 rounded-lg transition relative ${
            activeSubTab === 'pending' ? 'bg-[#21262d] text-white shadow' : 'text-[#7d8590] hover:text-white'
          }`}
        >
          İstekler
          {pendingRequests.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px]">
              {pendingRequests.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('add')}
          className={`flex-1 py-1.5 rounded-lg transition flex items-center justify-center space-x-1 ${
            activeSubTab === 'add' ? 'bg-indigo-600 text-white shadow' : 'text-[#7d8590] hover:text-white'
          }`}
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Ekle</span>
        </button>
      </div>

      {/* 1. ARKADAŞLAR LİSTESİ */}
      {activeSubTab === 'list' && (
        <div className="space-y-1.5">
          {friends.length === 0 ? (
            <div className="text-center py-8 text-[#7d8590] text-xs">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Henüz arkadaşınız yok.</p>
              <button
                onClick={() => setActiveSubTab('add')}
                className="mt-2 text-indigo-400 font-bold hover:underline"
              >
                + 10 Haneli ID ile Ekle
              </button>
            </div>
          ) : (
            friends.map(({ friendshipId, profile }) => {
              const onlineData = allUsers?.find(
                u => u.username?.toLowerCase() === profile.username?.toLowerCase()
              );
              const isOnline = Boolean(onlineData);
              const inVoice = onlineData?.currentVoiceRoom;
              const inVoiceRoomName = inVoice
                ? channels.voice?.find(v => v.id === inVoice)?.name
                : null;

              return (
                <div
                  key={friendshipId}
                  className="p-3 rounded-2xl bg-[#21262d]/60 border border-[#30363d] flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    <div className="relative flex-shrink-0">
                      <span className="text-2xl">{profile.avatar || '🎮'}</span>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#161b22] ${
                        isOnline ? 'bg-emerald-500' : 'bg-[#7d8590]'
                      }`} />
                    </div>

                    <div className="truncate">
                      <div className="text-sm font-bold text-white truncate flex items-center space-x-1.5">
                        <span>{profile.username}</span>
                      </div>
                      <div className="text-[11px] font-medium truncate font-mono text-[#7d8590]">
                        {inVoiceRoomName ? (
                          <span className="text-emerald-400 flex items-center space-x-1 font-sans">
                            <Radio className="w-3 h-3 animate-pulse" />
                            <span>{inVoiceRoomName}</span>
                          </span>
                        ) : (
                          <span>ID: {profile.user_code || '------'}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5">
                    {inVoice && inVoice !== activeVoiceChannel && (
                      <button
                        onClick={() => onJoinRoom(inVoice)}
                        title="Odaya Katıl"
                        className="px-2.5 py-1 rounded-xl bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-black text-xs font-bold transition flex items-center space-x-1"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>Katıl</span>
                      </button>
                    )}

                    {activeVoiceChannel && (
                      <button
                        onClick={() => handleInviteToRoom(profile.id)}
                        title="Odaya Davet Et"
                        className="px-2.5 py-1 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 text-xs font-bold transition flex items-center space-x-1 shadow"
                      >
                        <PhoneCall className="w-3 h-3" />
                        <span>Davet Et</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 2. BEKLEYEN İSTEKLER */}
      {activeSubTab === 'pending' && (
        <div className="space-y-2">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-8 text-[#7d8590] text-xs">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Bekleyen arkadaşlık isteği yok.</p>
            </div>
          ) : (
            pendingRequests.map((req) => (
              <div
                key={req.id}
                className="p-3 rounded-2xl bg-[#21262d] border border-[#30363d] flex items-center justify-between"
              >
                <div className="flex items-center space-x-2.5 truncate">
                  <span className="text-2xl">{req.user?.avatar || '🎮'}</span>
                  <div className="truncate">
                    <div className="text-sm font-bold text-white truncate">
                      {req.user?.username}
                    </div>
                    <div className="text-[10px] text-[#7d8590] font-mono">
                      ID: {req.user?.user_code || '------'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleAcceptRequest(req.id)}
                    title="Kabul Et"
                    className="p-1.5 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 transition"
                  >
                    <Check className="w-4 h-4 font-bold" />
                  </button>
                  <button
                    onClick={() => handleRejectRequest(req.id)}
                    title="Reddet"
                    className="p-1.5 rounded-xl bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition"
                  >
                    <X className="w-4 h-4 font-bold" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* 3. 10 HANELİ ID İLE ARKADAŞ EKLE */}
      {activeSubTab === 'add' && (
        <div className="p-3.5 rounded-2xl bg-[#21262d] border border-[#30363d] space-y-3">
          <div className="text-xs font-bold text-white flex items-center space-x-1.5">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <span>10 Haneli ID ile Arkadaş Ekle</span>
          </div>

          <form onSubmit={handleSendRequest} className="space-y-2.5">
            <input
              type="text"
              required
              placeholder="10 Haneli ID (Örn: 8492019482)..."
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none font-mono"
            />

            <button
              type="submit"
              disabled={loading || !searchCode.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-2 rounded-xl text-xs transition shadow"
            >
              {loading ? 'Aranıyor...' : 'Arkadaşlık İsteği Gönder'}
            </button>
          </form>

          {searchStatus.text && (
            <div className={`p-2.5 rounded-xl text-xs font-medium ${
              searchStatus.type === 'success' 
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400' 
                : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
            }`}>
              {searchStatus.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
