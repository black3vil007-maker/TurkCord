import React, { useState, useEffect } from 'react';
import { socket } from './services/socket';
import { webrtc } from './services/webrtc';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { 
  Volume2, 
  Hash, 
  Mic, 
  MicOff, 
  Headphones, 
  Settings, 
  PhoneOff, 
  Monitor, 
  MessageSquare,
  Users,
  ChevronRight,
  LogOut,
  PhoneCall,
  Check,
  X
} from 'lucide-react';
import AuthModal from './components/AuthModal';
import FriendsPanel from './components/FriendsPanel';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('voice'); // 'voice', 'chat', 'friends'
  const [channels, setChannels] = useState({ text: [], voice: [] });
  const [activeTextChannel, setActiveTextChannel] = useState('genel');
  const [activeVoiceChannel, setActiveVoiceChannel] = useState(null);
  const [messages, setMessages] = useState({});
  const [allUsers, setAllUsers] = useState([]);
  const [voiceRooms, setVoiceRooms] = useState({});
  const [speakingUsers, setSpeakingUsers] = useState({});
  const [peers, setPeers] = useState({});
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [livePing, setLivePing] = useState(12);

  // Incoming Room Invite State
  const [incomingInvite, setIncomingInvite] = useState(null);

  // 1. Check Supabase Auth Session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        loadUserProfile(currentSession.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user) {
        loadUserProfile(currentSession.user);
      } else {
        setCurrentUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (user) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      const userObj = {
        id: user.id,
        email: user.email,
        username: profile?.username || user.user_metadata?.username || user.email.split('@')[0],
        avatar: profile?.avatar || user.user_metadata?.avatar || '🎮'
      };

      setCurrentUser(userObj);
      if (socket.connected) {
        socket.emit('user:join', userObj);
      }
    } catch (e) {
      console.warn('Profile load err:', e);
    }
  };

  // 2. Realtime Room Invites Listener
  useEffect(() => {
    if (!currentUser?.id) return;

    const channel = supabase
      .channel(`invites:${currentUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_invites',
          filter: `to_user_id=eq.${currentUser.id}`
        },
        async (payload) => {
          const invite = payload.new;
          if (invite.status === 'pending') {
            // Get sender name
            const { data: sender } = await supabase
              .from('profiles')
              .select('username, avatar')
              .eq('id', invite.from_user_id)
              .single();

            setIncomingInvite({
              ...invite,
              senderName: sender?.username || 'Arkadaşın',
              senderAvatar: sender?.avatar || '🎮'
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  // 3. Socket & WebRTC setup
  useEffect(() => {
    socket.connect();

    socket.on('connect', () => {
      if (currentUser) {
        socket.emit('user:join', currentUser);
      }
    });

    socket.on('init:state', (state) => {
      setChannels(state.channels);
      setAllUsers(state.users);
      setVoiceRooms(state.voiceRooms);
      setMessages(state.messages || {});
    });

    socket.on('users:updated', (usersList) => {
      setAllUsers(usersList);
      if (currentUser) {
        const me = usersList.find(u => u.id === socket.id || u.username === currentUser.username);
        if (me) setCurrentUser(prev => ({ ...prev, ...me }));
      }
    });

    socket.on('voice:rooms-updated', (roomsData) => {
      setVoiceRooms(roomsData);
    });

    socket.on('chat:message', (newMsg) => {
      setMessages(prev => ({
        ...prev,
        [newMsg.channelId]: [...(prev[newMsg.channelId] || []), newMsg]
      }));
    });

    socket.on('voice:peers', async ({ roomId, peers: existingPeers }) => {
      for (const p of existingPeers) {
        await webrtc.createPeerConnection(p.id, true);
      }
    });

    socket.on('voice:user-left', ({ peerId }) => {
      webrtc.closePeer(peerId);
      setSpeakingUsers(prev => {
        const copy = { ...prev };
        delete copy[peerId];
        return copy;
      });
    });

    socket.on('webrtc:offer', async ({ from, offer }) => {
      await webrtc.handleOffer(from, offer);
    });

    socket.on('webrtc:answer', async ({ from, answer }) => {
      await webrtc.handleAnswer(from, answer);
    });

    socket.on('webrtc:ice-candidate', async ({ from, candidate }) => {
      await webrtc.handleCandidate(from, candidate);
    });

    socket.on('voice:peer-speaking', ({ peerId, isSpeaking }) => {
      setSpeakingUsers(prev => ({ ...prev, [peerId]: isSpeaking }));
    });

    webrtc.onSpeakingChange = (id, isSpeaking) => {
      setSpeakingUsers(prev => ({ ...prev, [id]: isSpeaking }));
    };

    webrtc.onPeersChange = (activePeers) => {
      setPeers(activePeers);
    };

    const pingInterval = setInterval(async () => {
      const ping = await webrtc.getAveragePing();
      if (ping !== null) setLivePing(ping);
    }, 2000);

    return () => {
      clearInterval(pingInterval);
      socket.off('connect');
      socket.off('init:state');
      socket.off('users:updated');
      socket.off('voice:rooms-updated');
      socket.off('chat:message');
      socket.off('voice:peers');
      socket.off('voice:user-left');
      socket.off('webrtc:offer');
      socket.off('webrtc:answer');
      socket.off('webrtc:ice-candidate');
      socket.off('voice:peer-speaking');
    };
  }, [currentUser]);

  const handleJoinVoiceChannel = async (roomId) => {
    if (activeVoiceChannel === roomId) {
      setActiveTab('voice');
      return;
    }
    try {
      await webrtc.initLocalAudio();
      setActiveVoiceChannel(roomId);
      setActiveTab('voice');
      socket.emit('voice:join', { roomId });
    } catch (err) {
      alert('Mikrofon erişimi reddedildi.');
    }
  };

  const handleLeaveVoice = () => {
    webrtc.leaveRoom();
    setActiveVoiceChannel(null);
    setIsScreenSharing(false);
    setScreenStream(null);
  };

  const handleToggleMute = () => {
    const isMuted = webrtc.toggleMute();
    setCurrentUser(prev => ({ ...prev, isMuted }));
  };

  const handleToggleDeafen = () => {
    const isDeafened = webrtc.toggleDeafen();
    setCurrentUser(prev => ({ ...prev, isDeafened, isMuted: webrtc.isMuted }));
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      webrtc.stopScreenShare();
      setIsScreenSharing(false);
      setScreenStream(null);
    } else {
      const stream = await webrtc.startScreenShare();
      if (stream) {
        setIsScreenSharing(true);
        setScreenStream(stream);
      }
    }
  };

  const handleSendMessage = (text) => {
    socket.emit('chat:message', {
      channelId: activeTextChannel,
      text
    });
  };

  const handleSignOut = async () => {
    if (activeVoiceChannel) handleLeaveVoice();
    await supabase.auth.signOut();
    setCurrentUser(null);
    setSession(null);
  };

  const handleUpdateProfile = async (updated) => {
    if (!currentUser?.id) return;
    await supabase
      .from('profiles')
      .update({ username: updated.username, avatar: updated.avatar })
      .eq('id', currentUser.id);

    const newUserData = { ...currentUser, ...updated };
    setCurrentUser(newUserData);
    socket.emit('user:join', newUserData);
  };

  // Accept incoming room invite
  const handleAcceptInvite = async () => {
    if (!incomingInvite) return;
    await supabase
      .from('room_invites')
      .update({ status: 'accepted' })
      .eq('id', incomingInvite.id);

    handleJoinVoiceChannel(incomingInvite.room_id);
    setIncomingInvite(null);
  };

  const handleDeclineInvite = async () => {
    if (!incomingInvite) return;
    await supabase
      .from('room_invites')
      .update({ status: 'declined' })
      .eq('id', incomingInvite.id);

    setIncomingInvite(null);
  };

  const currentVoiceRoomUsers = activeVoiceChannel ? (voiceRooms[activeVoiceChannel] || []) : [];
  const currentVoiceObj = channels.voice?.find(v => v.id === activeVoiceChannel);
  const currentTextObj = channels.text?.find(c => c.id === activeTextChannel) || channels.text?.[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-[#e6edf3] font-sans antialiased relative">
      {/* Gelen Canlı Oda Daveti Bildirimi (Floating Toast) */}
      {incomingInvite && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 bg-[#161b22] border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl flex items-center space-x-4 animate-bounce-subtle">
          <div className="text-3xl">{incomingInvite.senderAvatar}</div>
          <div>
            <div className="text-sm font-bold text-white">
              {incomingInvite.senderName} seni davet ediyor!
            </div>
            <div className="text-xs text-emerald-400 font-medium">
              🔊 {incomingInvite.room_name} odasına katılmak ister misin?
            </div>
          </div>
          <div className="flex items-center space-x-2 pl-2">
            <button
              onClick={handleAcceptInvite}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-black font-bold text-xs hover:bg-emerald-400 transition"
            >
              Katıl
            </button>
            <button
              onClick={handleDeclineInvite}
              className="p-1.5 rounded-xl bg-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SOL PANEL: TEK, TEMİZ & SADE LİSTE                          */}
      {/* ============================================================ */}
      <aside className="w-80 bg-[#161b22] border-r border-[#30363d] flex flex-col justify-between flex-shrink-0 z-20">
        <div>
          {/* Header */}
          <div className="h-16 px-5 border-b border-[#30363d] flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-lg font-black shadow-md">
                TC
              </div>
              <div>
                <h1 className="text-base font-extrabold text-white leading-tight">TurkCord</h1>
                <p className="text-[11px] text-[#7d8590]">Sıfır Gecikmeli Ses & Sohbet</p>
              </div>
            </div>

            <button
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-xl text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
              title="Ayarlar"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* 3 Net Sekme: Ses Odaları | Metin | Arkadaşlar */}
          <div className="p-3">
            <div className="flex rounded-xl bg-[#0d1117] p-1 border border-[#30363d]">
              <button
                onClick={() => setActiveTab('voice')}
                className={`flex-1 flex items-center justify-center space-x-1 py-2 rounded-lg text-xs font-bold transition ${
                  activeTab === 'voice'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-[#7d8590] hover:text-white'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Ses</span>
              </button>

              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 flex items-center justify-center space-x-1 py-2 rounded-lg text-xs font-bold transition ${
                  activeTab === 'chat'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-[#7d8590] hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Metin</span>
              </button>

              <button
                onClick={() => setActiveTab('friends')}
                className={`flex-1 flex items-center justify-center space-x-1 py-2 rounded-lg text-xs font-bold transition ${
                  activeTab === 'friends'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-[#7d8590] hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Kadro</span>
              </button>
            </div>
          </div>

          {/* Liste İçeriği */}
          <div className="px-3 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
            {activeTab === 'voice' && (
              // 1. SES ODALARI LİSTESİ
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-bold text-[#7d8590] uppercase tracking-wider px-2">
                  Aktif Ses Odaları
                </div>

                {channels.voice?.map((v) => {
                  const isCurrent = activeVoiceChannel === v.id;
                  const usersInRoom = voiceRooms[v.id] || [];

                  return (
                    <div
                      key={v.id}
                      onClick={() => handleJoinVoiceChannel(v.id)}
                      className={`p-3 rounded-2xl cursor-pointer transition-all border ${
                        isCurrent
                          ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
                          : 'bg-[#21262d]/50 hover:bg-[#21262d] border-[#30363d]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                            isCurrent ? 'bg-emerald-500 text-black' : 'bg-[#30363d] text-white'
                          }`}>
                            <Volume2 className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white">{v.name}</div>
                            <div className="text-[11px] text-[#7d8590]">
                              {usersInRoom.length === 0 ? 'Oda boş' : `${usersInRoom.length} kişi bağlı`}
                            </div>
                          </div>
                        </div>

                        {isCurrent ? (
                          <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full animate-pulse">
                            Bağlısın
                          </span>
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[#7d8590]" />
                        )}
                      </div>

                      {usersInRoom.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-[#30363d]/60">
                          {usersInRoom.map((u) => {
                            const isSpeaking = speakingUsers[u.id];
                            return (
                              <div
                                key={u.id}
                                className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-xs ${
                                  isSpeaking 
                                    ? 'bg-emerald-500 text-black font-bold ring-2 ring-emerald-400' 
                                    : 'bg-[#30363d] text-[#c9d1d9]'
                                }`}
                              >
                                <span>{u.avatar || '🎮'}</span>
                                <span className="max-w-[70px] truncate">{u.username}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === 'chat' && (
              // 2. METİN KANALLARI LİSTESİ
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-bold text-[#7d8590] uppercase tracking-wider px-2">
                  Metin Kanalları
                </div>

                {channels.text?.map((c) => {
                  const isCurrent = activeTextChannel === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveTextChannel(c.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl text-sm font-semibold transition ${
                        isCurrent
                          ? 'bg-indigo-600 text-white shadow'
                          : 'text-[#c9d1d9] hover:bg-[#21262d]'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 truncate">
                        <Hash className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{c.name}</span>
                      </div>
                      {isCurrent && <span className="w-2 h-2 rounded-full bg-white" />}
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'friends' && (
              // 3. ARKADAŞLAR PANELİ
              <FriendsPanel
                currentUser={currentUser}
                activeVoiceChannel={activeVoiceChannel}
                channels={channels}
                allUsers={allUsers}
                onJoinRoom={handleJoinVoiceChannel}
              />
            )}
          </div>
        </div>

        {/* Sol Panel Altı: Kullanıcı & Ses Kartı */}
        <div className="p-3 border-t border-[#30363d] bg-[#161b22]">
          {activeVoiceChannel && (
            <div className="mb-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold text-emerald-400 truncate">
                  {currentVoiceObj?.name}
                </span>
              </div>
              <button
                onClick={handleLeaveVoice}
                className="p-1 rounded-lg text-rose-400 hover:bg-rose-500 hover:text-white transition"
                title="Odadan Ayrıl"
              >
                <PhoneOff className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Profil, Mikrofon & Çıkış */}
          <div className="flex items-center justify-between">
            <div 
              onClick={() => setShowSettings(true)}
              className="flex items-center space-x-2.5 cursor-pointer hover:opacity-80 transition truncate max-w-[125px]"
            >
              <div className="relative flex-shrink-0">
                <span className="text-2xl">{currentUser?.avatar || '🎮'}</span>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#161b22]" />
              </div>
              <div className="truncate">
                <div className="text-sm font-bold text-white truncate leading-tight">
                  {currentUser?.username || 'Giriş Yapılmadı'}
                </div>
                <div className="text-[11px] text-emerald-400">Çevrimiçi</div>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={handleToggleMute}
                className={`p-2 rounded-xl transition ${
                  currentUser?.isMuted
                    ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                    : 'text-[#7d8590] hover:text-white hover:bg-[#21262d]'
                }`}
                title={currentUser?.isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
              >
                {currentUser?.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <button
                onClick={handleToggleDeafen}
                className={`p-2 rounded-xl transition ${
                  currentUser?.isDeafened
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : 'text-[#7d8590] hover:text-white hover:bg-[#21262d]'
                }`}
                title={currentUser?.isDeafened ? 'Kulaklığı Aç' : 'Kulaklığı Kapat'}
              >
                <Headphones className="w-4 h-4" />
              </button>

              <button
                onClick={handleSignOut}
                className="p-2 rounded-xl text-[#7d8590] hover:text-rose-400 hover:bg-[#21262d] transition"
                title="Çıkış Yap"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ============================================================ */}
      {/* ANA EKRAN: FERAH, GENİŞ SES ODASI VEYA SOHBET ALANI          */}
      {/* ============================================================ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0d1117] relative">
        {activeTab === 'voice' ? (
          activeVoiceChannel ? (
            <div className="flex-1 flex flex-col h-full p-6 justify-between">
              {/* Üst Bar */}
              <div className="flex items-center justify-between pb-4 border-b border-[#30363d]">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                    <Volume2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white">{currentVoiceObj?.name}</h2>
                    <p className="text-xs text-[#7d8590]">{currentVoiceRoomUsers.length} kişi bu odada konuşuyor</p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>{livePing} ms</span>
                  </div>
                </div>
              </div>

              {/* Ekran Paylaşımı Varsa */}
              {(screenStream || Object.values(peers).some(p => p.remoteStream?.getVideoTracks().length > 0)) && (
                <div className="my-4 relative rounded-2xl overflow-hidden bg-black aspect-video max-h-[50vh] mx-auto border border-[#30363d] flex items-center justify-center shadow-2xl">
                  {screenStream ? (
                    <LocalVideoPreview stream={screenStream} />
                  ) : (
                    Object.entries(peers)
                      .filter(([_, p]) => p.remoteStream?.getVideoTracks().length > 0)
                      .map(([id, p]) => <LocalVideoPreview key={id} stream={p.remoteStream} />)
                  )}
                  <span className="absolute top-3 left-3 bg-black/70 px-3 py-1 rounded-full text-xs font-bold text-white backdrop-blur">
                    🔴 Canlı Ekran Yayını
                  </span>
                </div>
              )}

              {/* Katılımcı Kartları */}
              <div className="flex-1 flex items-center justify-center py-6">
                <div className={`grid gap-5 w-full max-w-4xl ${
                  currentVoiceRoomUsers.length <= 2 
                    ? 'grid-cols-1 sm:grid-cols-2' 
                    : 'grid-cols-2 sm:grid-cols-3'
                }`}>
                  {currentVoiceRoomUsers.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    const isSpeaking = speakingUsers[u.id];

                    return (
                      <div
                        key={u.id}
                        className={`aspect-[4/3] rounded-3xl bg-[#161b22] border-2 flex flex-col items-center justify-center transition-all p-4 shadow-lg ${
                          isSpeaking
                            ? 'border-emerald-500 ring-4 ring-emerald-500/20 scale-105'
                            : 'border-[#30363d]'
                        }`}
                      >
                        <div className="relative mb-3">
                          <div className={`w-24 h-24 rounded-full bg-[#21262d] flex items-center justify-center text-5xl transition-transform ${
                            isSpeaking ? 'scale-110 shadow-lg' : ''
                          }`}>
                            {u.avatar || '🎮'}
                          </div>
                          {isSpeaking && (
                            <span className="absolute -inset-1 rounded-full border-2 border-emerald-400 animate-ping opacity-75" />
                          )}
                        </div>

                        <div className="flex items-center space-x-1.5 font-bold text-white text-sm">
                          <span>{u.username}</span>
                          {isSelf && <span className="text-[11px] text-[#7d8590]">(Sen)</span>}
                        </div>

                        <div className="flex items-center space-x-1.5 mt-1 text-[#7d8590] text-xs">
                          {u.isMuted && <span className="text-rose-400 font-medium">Susturuldu</span>}
                          {u.isDeafened && <span className="text-amber-400 font-medium">Sağır</span>}
                          {!u.isMuted && !u.isDeafened && (
                            <span className={isSpeaking ? 'text-emerald-400 font-bold' : 'text-[#7d8590]'}>
                              {isSpeaking ? 'Konuşuyor 🎙️' : 'Dinliyor'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Alt Ses Kontrol Barı */}
              <div className="h-20 bg-[#161b22] border border-[#30363d] rounded-2xl flex items-center justify-center space-x-3 px-6 shadow-xl">
                <button
                  onClick={handleToggleMute}
                  className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-bold text-sm transition ${
                    currentUser?.isMuted
                      ? 'bg-rose-500 text-white'
                      : 'bg-[#21262d] text-white hover:bg-[#30363d]'
                  }`}
                >
                  {currentUser?.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-emerald-400" />}
                  <span>{currentUser?.isMuted ? 'Mikrofon Aç' : 'Mikrofon Kapat'}</span>
                </button>

                <button
                  onClick={handleToggleDeafen}
                  className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-bold text-sm transition ${
                    currentUser?.isDeafened
                      ? 'bg-amber-500 text-white'
                      : 'bg-[#21262d] text-white hover:bg-[#30363d]'
                  }`}
                >
                  <Headphones className="w-5 h-5" />
                  <span>{currentUser?.isDeafened ? 'Kulaklık Aç' : 'Kulaklık'}</span>
                </button>

                <button
                  onClick={handleToggleScreenShare}
                  className={`flex items-center space-x-2 px-5 py-3 rounded-xl font-bold text-sm transition ${
                    isScreenSharing
                      ? 'bg-emerald-500 text-white'
                      : 'bg-[#21262d] text-white hover:bg-[#30363d]'
                  }`}
                >
                  <Monitor className="w-5 h-5" />
                  <span>{isScreenSharing ? 'Yayını Bitir' : 'Ekran Paylaş'}</span>
                </button>

                <button
                  onClick={handleLeaveVoice}
                  className="flex items-center space-x-2 px-6 py-3 rounded-xl font-bold text-sm bg-rose-500 hover:bg-rose-600 text-white transition shadow-md"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span>Odadan Ayrıl</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-20 h-20 rounded-3xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-4xl mb-4 shadow-xl">
                🎙️
              </div>
              <h2 className="text-2xl font-black text-white">Henüz bir ses odasında değilsin</h2>
              <p className="text-sm text-[#7d8590] max-w-md mt-2">
                Arkadaşlarınla konuşmak için sol menüden bir ses odasına tıkla veya Kadro sekmesinden arkadaşını davet et.
              </p>
              <div className="flex gap-3 mt-6">
                {channels.voice?.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handleJoinVoiceChannel(v.id)}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow-md"
                  >
                    {v.name}'a Katıl
                  </button>
                ))}
              </div>
            </div>
          )
        ) : activeTab === 'chat' ? (
          <CleanChatView
            channel={currentTextObj}
            messages={messages[activeTextChannel] || []}
            onSendMessage={handleSendMessage}
            activeVoiceChannel={activeVoiceChannel}
            onGoToVoice={() => setActiveTab('voice')}
          />
        ) : (
          // Kadro sekmesindeyken sağ ekranda hızlı davet veya lobi durumu
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 rounded-3xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-4xl mb-4 shadow-xl">
              👥
            </div>
            <h2 className="text-2xl font-black text-white">Kadro & Arkadaşlar Yönetimi</h2>
            <p className="text-sm text-[#7d8590] max-w-md mt-2">
              Sol paneldeki <b>Kadro</b> sekmesinden arkadaşlarını ekleyebilir, çevrimiçi olanları ses odana davet edebilirsin.
            </p>
            {activeVoiceChannel && (
              <button
                onClick={() => setActiveTab('voice')}
                className="mt-6 px-5 py-2.5 bg-emerald-500 text-black font-bold text-sm rounded-xl hover:bg-emerald-400 transition"
              >
                Ses Odama Dön ({currentVoiceObj?.name})
              </button>
            )}
          </div>
        )}
      </main>

      {/* Auth Modal (Kayıt / Onay / Giriş) */}
      {!currentUser && (
        <AuthModal onAuthSuccess={(user) => {
          setCurrentUser(user);
          if (socket.connected) socket.emit('user:join', user);
        }} />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentUser={currentUser}
          onClose={() => setShowSettings(false)}
          onUpdateUser={handleUpdateProfile}
        />
      )}
    </div>
  );
}

// Sade Sohbet Bileşeni
function CleanChatView({ channel, messages, onSendMessage, activeVoiceChannel, onGoToVoice }) {
  const [inputText, setInputText] = useState('');
  const endRef = React.useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="h-16 px-6 border-b border-[#30363d] flex items-center justify-between bg-[#161b22]/50 backdrop-blur">
        <div className="flex items-center space-x-2">
          <Hash className="w-5 h-5 text-indigo-400" />
          <span className="font-extrabold text-white text-base">{channel?.name}</span>
          <span className="text-xs text-[#7d8590] ml-2 hidden sm:inline">{channel?.description}</span>
        </div>

        {activeVoiceChannel && (
          <button
            onClick={onGoToVoice}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-black font-bold text-xs flex items-center space-x-1.5 hover:bg-emerald-400 transition shadow"
          >
            <Volume2 className="w-4 h-4 animate-bounce" />
            <span>Sese Dön</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((m, idx) => (
          <div key={m.id || idx} className="flex items-start space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#21262d] flex items-center justify-center text-xl flex-shrink-0">
              {m.sender?.avatar || '🎮'}
            </div>
            <div className="flex-1">
              <div className="flex items-baseline space-x-2">
                <span className="font-bold text-white text-sm">{m.sender?.username}</span>
                <span className="text-[11px] text-[#7d8590]">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-sm text-[#e6edf3] mt-0.5 leading-relaxed bg-[#161b22] p-3 rounded-2xl rounded-tl-none border border-[#30363d] inline-block max-w-xl">
                {m.text}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 bg-[#161b22] border-t border-[#30363d] flex items-center space-x-3">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={`#${channel?.name || 'sohbet'} kanalına yaz...`}
          className="flex-1 bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-white outline-none transition"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition disabled:opacity-40"
        >
          Gönder
        </button>
      </form>
    </div>
  );
}

function LocalVideoPreview({ stream }) {
  const ref = React.useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="w-full h-full object-contain" />;
}
