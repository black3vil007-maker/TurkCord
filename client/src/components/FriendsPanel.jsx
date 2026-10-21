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
  Search,
  Sparkles,
  Send,
  Radio
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
  const [searchUsername, setSearchUsername] = useState('');
  const [searchStatus, setSearchStatus] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('list'); // 'list', 'pending', 'add'

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
          user:profiles!friendships_user_id_fkey(id, username, avatar),
          friend:profiles!friendships_friend_id_fkey(id, username, avatar)
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
          user:profiles!friendships_user_id_fkey(id, username, avatar)
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

    // Subscribe to realtime friendship updates
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

  // Send friend request
  const handleSendRequest = async (e) => {
    e.preventDefault();
    setSearchStatus({ type: '', text: '' });

    const targetName = searchUsername.trim();
    if (!targetName) return;

    if (targetName.toLowerCase() === currentUser?.username?.toLowerCase()) {
      setSearchStatus({ type: 'error', text: 'Kendinize arkadaşlık isteği gönderemezsiniz!' });
      return;
    }

    setLoading(true);

    try {
      // Find profile by username
      const { data: targetProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', targetName)
        .single();

      if (profileErr || !targetProfile) {
        setSearchStatus({ type: 'error', text: `"${targetName}" adında bir kullanıcı bulunamadı.` });
        setLoading(false);
        return;
      }

      // Send request
      const { error: insertErr } = await supabase
        .from('friendships')
        .insert({
          user_id: currentUser.id,
          friend_id: targetProfile.id,
          status: 'pending'
        });

      if (insertErr) {
        if (insertErr.code === '23505') {
          setSearchStatus({ type: 'error', text: 'Bu kullanıcıya zaten istek gönderilmiş veya arkadaşsınız.' });
        } else {
          setSearchStatus({ type: 'error', text: insertErr.message });
        }
      } else {
        setSearchStatus({ type: 'success', text: `Arkadaşlık isteği "${targetProfile.username}" kullanıcısına iletildi! 🎉` });
        setSearchUsername('');
      }
    } catch (err) {
      setSearchStatus({ type: 'error', text: 'İstek gönderilirken hata oluştu.' });
    } finally {
      setLoading(false);
    }
  };

  // Accept request
  const handleAcceptRequest = async (friendshipId) => {
    await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId);

    loadFriendships();
  };

  // Reject / Delete request
  const handleRejectRequest = async (friendshipId) => {
    await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    loadFriendships();
  };

  // Send room invite to friend
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
                + Arkadaş Ekle
              </button>
            </div>
          ) : (
            friends.map(({ friendshipId, profile }) => {
              // Check if friend is currently online in socket
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
                      <div className="text-sm font-bold text-white truncate">
                        {profile.username}
                      </div>
                      <div className="text-[11px] font-medium truncate">
                        {inVoiceRoomName ? (
                          <span className="text-emerald-400 flex items-center space-x-1">
                            <Radio className="w-3 h-3 animate-pulse" />
                            <span>{inVoiceRoomName}</span>
                          </span>
                        ) : isOnline ? (
                          <span className="text-emerald-400">Çevrimiçi</span>
                        ) : (
                          <span className="text-[#7d8590]">Çevrimdışı</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-1.5">
                    {/* If friend is in a room, join them */}
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

                    {/* If you are in a room, invite friend */}
                    {activeVoiceChannel && (
                      <button
                        onClick={() => handleInviteToRoom(profile.id)}
                        title="Odaya Davet Et"
                        className="p-1.5 rounded-xl bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white transition"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
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
                    <div className="text-[11px] text-[#7d8590]">Arkadaşlık isteği gönderdi</div>
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

      {/* 3. ARKADAŞ EKLE */}
      {activeSubTab === 'add' && (
        <div className="p-3 rounded-2xl bg-[#21262d] border border-[#30363d] space-y-3">
          <div className="text-xs font-bold text-white flex items-center space-x-1.5">
            <UserPlus className="w-4 h-4 text-indigo-400" />
            <span>Kullanıcı Adı ile Arkadaş Ekle</span>
          </div>

          <form onSubmit={handleSendRequest} className="space-y-2.5">
            <input
              type="text"
              required
              placeholder="Arkadaşının kullanıcı adı..."
              value={searchUsername}
              onChange={(e) => setSearchUsername(e.target.value)}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-xs text-white outline-none font-medium"
            />

            <button
              type="submit"
              disabled={loading || !searchUsername.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-2 rounded-xl text-xs transition"
            >
              {loading ? 'Aranıyor...' : 'İstek Gönder'}
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
