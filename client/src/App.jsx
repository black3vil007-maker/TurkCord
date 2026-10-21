import React, { useState, useEffect, useRef } from 'react';
import { socket } from './services/socket';
import { webrtc } from './services/webrtc';
import { supabase } from './services/supabase';
import { soundEffects } from './services/soundEffects';
import { 
  Volume2, 
  VolumeX,
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
  Plus,
  X,
  Radio,
  Check,
  Lock,
  Unlock,
  Pencil,
  Trash2,
  KeyRound,
  Zap,
  Maximize2,
  Minimize2,
  Tv,
  Download,
  Laptop,
  UserPlus,
  Clock,
  ShieldAlert,
  UserMinus,
  Ban
} from 'lucide-react';
import AuthModal from './components/AuthModal';
import FriendsPanel from './components/FriendsPanel';
import SettingsModal from './components/SettingsModal';
import AdminPanelModal from './components/AdminPanelModal';
import TurkCordLogo from './components/TurkCordLogo';
import { realtimeSignaling } from './services/realtimeSignaling';

export default function App() {
  const [session, setSession] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [friendsSet, setFriendsSet] = useState(new Set());
  const [pendingSentRequests, setPendingSentRequests] = useState(new Set());
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);
  const [adminNoticeModal, setAdminNoticeModal] = useState(null);
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
  const [screenShareNotification, setScreenShareNotification] = useState(null);
  const [endedBroadcast, setEndedBroadcast] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [livePing, setLivePing] = useState(12);
  const [roomEventToast, setRoomEventToast] = useState(null);

  // References to track room members and trigger join/leave sounds
  const activeVoiceChannelRef = useRef(activeVoiceChannel);
  const prevRoomMembersRef = useRef(new Set());

  useEffect(() => {
    activeVoiceChannelRef.current = activeVoiceChannel;
  }, [activeVoiceChannel]);

  // Create room modal / form state
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomLimit, setNewRoomLimit] = useState(5);
  const [newRoomIsPassword, setNewRoomIsPassword] = useState(false);
  const [newRoomPassword, setNewRoomPassword] = useState('');

  // Edit / Password Room States
  const [editingRoom, setEditingRoom] = useState(null);
  const [passwordPromptRoom, setPasswordPromptRoom] = useState(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [unlockedRooms, setUnlockedRooms] = useState({});
  const [viewerResolution, setViewerResolution] = useState('auto'); // 'auto', '1080p', '720p', '480p'

  // Incoming Room Invite & Friend Requests
  const [incomingInvite, setIncomingInvite] = useState(null);
  const [pendingFriendCount, setPendingFriendCount] = useState(0);
  const [incomingFriendToast, setIncomingFriendToast] = useState(null);

  // Per-participant individual volume controls (0% to 200%)
  const [userVolumes, setUserVolumes] = useState(() => webrtc.loadPeerVolumes());

  const handleUserVolumeChange = (userId, volume) => {
    setUserVolumes(prev => ({ ...prev, [userId]: volume }));
    webrtc.setPeerVolume(userId, volume);
    const targetUser = allUsers.find(u => u.id === userId);
    if (targetUser?.socketId && targetUser.socketId !== userId) {
      webrtc.setPeerVolume(targetUser.socketId, volume);
    }
  };

  const handleToggleUserMute = (userId) => {
    const currentVol = userVolumes[userId] ?? 100;
    if (currentVol === 0) {
      handleUserVolumeChange(userId, 100);
    } else {
      handleUserVolumeChange(userId, 0);
    }
  };

  // PWA Desktop Application Installation States
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const [showInstallGuideModal, setShowInstallGuideModal] = useState(false);

  useEffect(() => {
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    ) {
      setIsStandaloneApp(true);
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', () => {
      setIsStandaloneApp(true);
      setDeferredPrompt(null);
      setShowInstallGuideModal(false);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        setIsStandaloneApp(true);
      }
      setDeferredPrompt(null);
    } else {
      setShowInstallGuideModal(true);
    }
  };

  const parseRoomData = (r) => {
    let name = r.name || 'Ses Odası';
    let password = r.password || null;

    if (typeof name === 'string' && name.includes(':::pwd:::')) {
      const parts = name.split(':::pwd:::');
      name = parts[0];
      password = parts[1] || null;
    }

    return {
      id: r.id,
      name,
      limit: r.limit_count || r.limit || 5,
      created_by: r.created_by,
      password: password || null,
      hasPassword: Boolean(password && String(password).trim().length > 0)
    };
  };

  const mergeVoiceChannels = (currentList = [], incomingList = []) => {
    const map = new Map();
    (currentList || []).forEach(item => {
      if (item && item.id) map.set(item.id, parseRoomData(item));
    });
    (incomingList || []).forEach(item => {
      if (item && item.id) {
        const parsed = parseRoomData(item);
        const existing = map.get(item.id) || {};
        map.set(item.id, { ...existing, ...parsed });
      }
    });
    return Array.from(map.values());
  };

  // Güvenlik Önlemi: Sağ tık (contextmenu) ve inceleme kısayollarını engelle
  useEffect(() => {
    const handleContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    const handleKeyDown = (e) => {
      // F12 veya Ctrl+Shift+I / J / C veya Ctrl+U (kaynak kod görüntüleme) engelle
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) ||
        (e.ctrlKey && (e.key === 'U' || e.key === 'u'))
      ) {
        e.preventDefault();
        return false;
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadPendingFriendCount = async (userId) => {
    if (!userId) return;
    try {
      const { count, error } = await supabase
        .from('friendships')
        .select('*', { count: 'exact', head: true })
        .eq('friend_id', userId)
        .eq('status', 'pending');
      if (!error && typeof count === 'number') {
        setPendingFriendCount(count);
      }
    } catch (e) {
      console.warn('Friend count err:', e);
    }
  };

  const loadFriendsData = async (userId) => {
    if (!userId) return;
    try {
      // 1. Kabul edilmiş arkadaşlar
      const { data: accepted } = await supabase
        .from('friendships')
        .select('user_id, friend_id')
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .eq('status', 'accepted');

      if (accepted) {
        const ids = new Set();
        accepted.forEach(f => {
          ids.add(f.user_id === userId ? f.friend_id : f.user_id);
        });
        setFriendsSet(ids);
      }

      // 2. Kullanıcının gönderdiği bekleyen istekler
      const { data: pendingSent } = await supabase
        .from('friendships')
        .select('friend_id')
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (pendingSent) {
        const sentIds = new Set(pendingSent.map(p => p.friend_id));
        setPendingSentRequests(sentIds);
      }
    } catch (e) {
      console.warn('Friends data load err:', e);
    }
  };

  const handleSendFriendRequestFromRoom = async (targetUser) => {
    if (!currentUser?.id || !targetUser?.id || targetUser.id === currentUser.id) return;

    if (friendsSet.has(targetUser.id)) {
      setRoomEventToast({
        type: 'join',
        text: `${targetUser.username} ile zaten arkadaşsınız.`
      });
      setTimeout(() => setRoomEventToast(null), 3000);
      return;
    }

    if (pendingSentRequests.has(targetUser.id)) {
      setRoomEventToast({
        type: 'join',
        text: `${targetUser.username} kişisine zaten istek gönderildi.`
      });
      setTimeout(() => setRoomEventToast(null), 3000);
      return;
    }

    try {
      const { error } = await supabase
        .from('friendships')
        .insert({
          user_id: currentUser.id,
          friend_id: targetUser.id,
          status: 'pending'
        });

      if (error) {
        if (error.code === '23505') {
          setRoomEventToast({
            type: 'join',
            text: 'Zaten bekleyen bir arkadaşlık isteği mevcut.'
          });
        } else {
          setRoomEventToast({
            type: 'join',
            text: 'İstek gönderilemedi: ' + error.message
          });
        }
      } else {
        setPendingSentRequests(prev => new Set(prev).add(targetUser.id));
        setRoomEventToast({
          type: 'join',
          text: `🎉 ${targetUser.username} kişisine arkadaşlık isteği gönderildi!`
        });

        if (socket.connected) {
          socket.emit('friend:request', {
            toUserCode: targetUser.user_code,
            toUsername: targetUser.username,
            fromUser: currentUser
          });
        }
      }
      setTimeout(() => setRoomEventToast(null), 3500);
    } catch (err) {
      console.warn('Send friend request err:', err);
    }
  };

  // 1. Check Supabase Auth Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user) {
        loadUserProfile(currentSession.user).finally(() => setIsAuthLoading(false));
      } else {
        setIsAuthLoading(false);
      }
    }).catch(() => {
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user) {
        loadUserProfile(currentSession.user).finally(() => setIsAuthLoading(false));
      } else {
        setCurrentUser(null);
        setIsAuthLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  const loadUserProfile = async (user) => {
    try {
      let { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      const userEmail = (user.email || '').toLowerCase().trim();
      const isSuperAdmin = Boolean(
        userEmail === 'aerayyoruk@gmail.com' ||
        userEmail.includes('aerayyoruk') ||
        profile?.username?.toLowerCase() === 'eray' ||
        profile?.is_admin === true
      );

      // Auto-promote super admin in database if missing
      if (isSuperAdmin && (!profile?.is_admin || !profile?.email)) {
        supabase.from('profiles').update({ is_admin: true, email: userEmail || 'aerayyoruk@gmail.com' }).eq('id', user.id).then(() => {});
      }

      // Pasif Hesap Kontrolü: Admin hariç pasife alınmış hesaplar sisteme giriş yapamaz
      if (profile?.is_passive === true && !isSuperAdmin) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setIsAuthLoading(false);
        setAdminNoticeModal({
          title: 'Hesabınız Pasife Alındı',
          message: 'Hesabınız yönetici tarafından pasife alınmıştır. Sisteme giriş izniniz durduruldu.',
          icon: '🚫'
        });
        return;
      }

      let userCode = profile?.user_code;
      if (!userCode) {
        userCode = Math.floor(1000000000 + Math.random() * 9000000000).toString();
        try {
          await supabase.from('profiles').update({ user_code: userCode }).eq('id', user.id);
        } catch (e) {}
      }

      const userObj = {
        id: user.id,
        email: user.email,
        isAdmin: isSuperAdmin || Boolean(profile?.is_admin),
        isPassive: Boolean(profile?.is_passive),
        username: profile?.username || user.user_metadata?.username || user.email.split('@')[0],
        avatar: profile?.avatar || user.user_metadata?.avatar || '🎮',
        user_code: userCode
      };

      setCurrentUser(userObj);
      loadPendingFriendCount(user.id);
      loadFriendsData(user.id);

      if (socket.connected) {
        socket.emit('user:join', userObj);
      }
    } catch (e) {
      console.warn('Profile load err:', e);
    } finally {
      setIsAuthLoading(false);
    }
  };

  // 2. Load and listen for persistent voice rooms from Supabase
  const loadVoiceRooms = async () => {
    try {
      const { data: dbRooms } = await supabase
        .from('voice_rooms')
        .select('*')
        .order('created_at', { ascending: true });

      if (dbRooms && dbRooms.length > 0) {
        const mapped = dbRooms.map(parseRoomData);
        setChannels(prev => ({
          ...prev,
          voice: mergeVoiceChannels(prev.voice, mapped)
        }));
      }
    } catch (err) {
      console.warn('[Rooms] Error loading voice_rooms:', err);
    }
  };

  useEffect(() => {
    loadVoiceRooms();

    const roomChannel = supabase
      .channel('public:voice_rooms')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'voice_rooms' },
        () => {
          loadVoiceRooms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
    };
  }, []);

  // Listen for realtime friendship changes for current user
  useEffect(() => {
    if (!currentUser?.id) return;
    loadPendingFriendCount(currentUser.id);
    loadFriendsData(currentUser.id);

    const fChannel = supabase
      .channel(`public:friendships-count-${currentUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => {
        loadPendingFriendCount(currentUser.id);
        loadFriendsData(currentUser.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(fChannel);
    };
  }, [currentUser?.id]);

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

  const currentEmail = (currentUser?.email || session?.user?.email || '').trim().toLowerCase();
  const isAdmin = Boolean(
    currentUser?.isAdmin === true ||
    currentUser?.is_admin === true ||
    currentEmail === 'aerayyoruk@gmail.com' ||
    currentEmail.includes('aerayyoruk') ||
    (currentUser?.username && currentUser.username.toLowerCase() === 'eray')
  );

  // 3. Admin Moderasyon Dinleyicisi (Supabase Realtime)
  useEffect(() => {
    if (!currentUser?.id) return;

    const adminChannel = supabase
      .channel('public:admin-moderation')
      .on('broadcast', { event: 'admin:kick' }, ({ payload }) => {
        if (payload?.targetUserId === currentUser.id) {
          handleLeaveVoice();
          setAdminNoticeModal({
            title: 'Odadan Çıkarıldınız',
            message: 'Yönetici tarafından ses odasından çıkarıldınız.',
            icon: '👢'
          });
        }
      })
      .on('broadcast', { event: 'admin:mute' }, ({ payload }) => {
        if (payload?.targetUserId === currentUser.id) {
          setIsForceMuted(Boolean(payload.isMuted));
          if (payload.isMuted) {
            webrtc.toggleMute(true);
            setCurrentUser(prev => ({ ...prev, isMuted: true }));
            setAdminNoticeModal({
              title: 'Sessize Alındınız',
              message: 'Yönetici tarafından sistem genelinde susturuldunuz.',
              icon: '🔇'
            });
          } else {
            setAdminNoticeModal({
              title: 'Ses Kilidi Açıldı',
              message: 'Yönetici mikrofon kilidinizi açtı.',
              icon: '🔊'
            });
          }
        }
      })
      .on('broadcast', { event: 'admin:deactivate' }, async ({ payload }) => {
        if (payload?.targetUserId === currentUser.id && currentUser.email?.toLowerCase() !== 'aerayyoruk@gmail.com') {
          handleLeaveVoice();
          if (socket.connected) socket.disconnect();
          await supabase.auth.signOut();
          setCurrentUser(null);
          setAdminNoticeModal({
            title: 'Hesabınız Pasife Alındı',
            message: 'Hesabınız yönetici tarafından pasife alınmıştır. Sisteme erişiminiz durduruldu.',
            icon: '🚫'
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(adminChannel);
    };
  }, [currentUser?.id]);

  // Admin Aksiyonları: aerayyoruk@gmail.com
  const handleAdminKickUser = async (targetUser) => {
    if (!isAdmin || !targetUser?.id) return;
    try {
      supabase.channel('public:admin-moderation').send({
        type: 'broadcast',
        event: 'admin:kick',
        payload: { targetUserId: targetUser.id }
      });
      if (socket.connected) {
        socket.emit('admin:kick', { targetUserId: targetUser.id });
      }
      setRoomEventToast({
        type: 'leave',
        text: `🛡️ ${targetUser.username} odadan atıldı.`
      });
      setTimeout(() => setRoomEventToast(null), 3500);
    } catch (e) {
      console.warn('Admin kick error:', e);
    }
  };

  const handleAdminToggleMute = async (targetUser, currentForceMute) => {
    if (!isAdmin || !targetUser?.id) return;
    const newMuteState = !currentForceMute;
    try {
      supabase.channel('public:admin-moderation').send({
        type: 'broadcast',
        event: 'admin:mute',
        payload: { targetUserId: targetUser.id, isMuted: newMuteState }
      });
      if (socket.connected) {
        socket.emit('admin:mute', { targetUserId: targetUser.id, isMuted: newMuteState });
      }
      setRoomEventToast({
        type: 'join',
        text: newMuteState ? `🔇 ${targetUser.username} susturuldu.` : `🔊 ${targetUser.username} sesi açıldı.`
      });
      setTimeout(() => setRoomEventToast(null), 3500);
    } catch (e) {
      console.warn('Admin mute error:', e);
    }
  };

  const handleAdminTogglePassive = async (targetUser, isCurrentlyPassive) => {
    if (!isAdmin || !targetUser?.id) return;
    const nextPassive = !isCurrentlyPassive;
    try {
      await supabase
        .from('profiles')
        .update({ is_passive: nextPassive })
        .eq('id', targetUser.id);

      if (nextPassive) {
        supabase.channel('public:admin-moderation').send({
          type: 'broadcast',
          event: 'admin:deactivate',
          payload: { targetUserId: targetUser.id }
        });
        if (socket.connected) {
          socket.emit('admin:deactivate', { targetUserId: targetUser.id });
        }
      }

      setRoomEventToast({
        type: nextPassive ? 'leave' : 'join',
        text: nextPassive
          ? `🚫 ${targetUser.username} hesabı pasife alındı.`
          : `✅ ${targetUser.username} hesabı aktife alındı.`
      });
      setTimeout(() => setRoomEventToast(null), 3500);
    } catch (e) {
      console.warn('Admin toggle passive error:', e);
    }
  };

  // 3. Supabase Realtime Presence & Cloud WebRTC Signaling (Works on Vercel & P2P)
  useEffect(() => {
    if (!currentUser?.id) return;

    realtimeSignaling.init(currentUser);

    realtimeSignaling.onPresenceChange = (rooms, onlineUsers) => {
      setVoiceRooms(rooms);
      if (onlineUsers && onlineUsers.length > 0) {
        setAllUsers(onlineUsers);
      }

      // Check if someone joined or left our active voice room
      const activeRoom = activeVoiceChannelRef.current;
      if (activeRoom) {
        const currentMembers = rooms[activeRoom] || [];
        const currentIds = new Set(currentMembers.map(u => u.id));
        const prevIds = prevRoomMembersRef.current;

        if (prevIds && prevIds.size > 0) {
          // Check for incoming members
          currentMembers.forEach(async (user) => {
            if (!prevIds.has(user.id) && user.id !== currentUser?.id) {
              soundEffects.playUserJoined();
              setRoomEventToast({
                type: 'join',
                text: `${user.username || 'Birisi'} odaya katıldı 👋`,
                user: user
              });
              setTimeout(() => setRoomEventToast(null), 4500);

              // If an old stale connection is in bad state, purge it
              if (webrtc.peers[user.id] && ['disconnected', 'failed', 'closed'].includes(webrtc.peers[user.id].connection?.connectionState)) {
                webrtc.closePeer(user.id);
              }

              // Connect to the incoming member if not already connected
              if (!webrtc.peers[user.id]) {
                const amIInitiator = (currentUser?.id || '') > (user.id || '');
                if (amIInitiator) {
                  console.log('[WebRTC] Establishing connection with newcomer:', user.username, user.id);
                  await webrtc.createPeerConnection(user.id, true);
                }
              }
            }
          });

          // Check for departing members
          prevIds.forEach(prevId => {
            if (!currentIds.has(prevId) && prevId !== currentUser?.id) {
              soundEffects.playUserLeft();
              // Immediately disconnect and cleanup WebRTC connection for departed member
              webrtc.closePeer(prevId);
              setPeers({ ...webrtc.peers });

              const leftUser = (onlineUsers || []).find(u => u.id === prevId);
              if (leftUser) {
                setRoomEventToast({
                  type: 'leave',
                  text: `${leftUser.username} odadan ayrıldı`
                });
                setTimeout(() => setRoomEventToast(null), 3500);
              }
            }
          });
        }

        prevRoomMembersRef.current = currentIds;
      }
    };

    realtimeSignaling.onOffer = async (fromId, offer) => {
      console.log('[Realtime] Incoming WebRTC offer from:', fromId);
      await webrtc.handleOffer(fromId, offer);
    };

    realtimeSignaling.onAnswer = async (fromId, answer) => {
      console.log('[Realtime] Incoming WebRTC answer from:', fromId);
      await webrtc.handleAnswer(fromId, answer);
    };

    realtimeSignaling.onCandidate = async (fromId, candidate) => {
      await webrtc.handleCandidate(fromId, candidate);
    };

    realtimeSignaling.onSpeaking = (fromId, isSpeaking) => {
      setSpeakingUsers(prev => ({ ...prev, [fromId]: isSpeaking }));
    };

    realtimeSignaling.onChatMessage = (newMsg) => {
      setMessages(prev => ({
        ...prev,
        [newMsg.channelId]: [...(prev[newMsg.channelId] || []).filter(m => m.id !== newMsg.id), newMsg]
      }));
    };

    realtimeSignaling.onRoomUpdated = (updatedRoom) => {
      const parsed = parseRoomData(updatedRoom);
      setChannels(prev => ({
        ...prev,
        voice: prev.voice.map(v => v.id === parsed.id ? { ...v, ...parsed } : v)
      }));
    };

    realtimeSignaling.onRoomDeleted = (roomId) => {
      setChannels(prev => ({
        ...prev,
        voice: prev.voice.filter(v => v.id !== roomId)
      }));
      if (activeVoiceChannel === roomId) {
        handleLeaveVoice();
      }
    };

    realtimeSignaling.onScreenShareToggle = (userId, isSharing) => {
      const broadcasterUser = allUsers.find(u => u.id === userId) || { username: 'Arkadaşın' };
      if (isSharing) {
        setEndedBroadcast(null);
        setScreenShareNotification({
          type: 'started',
          userName: broadcasterUser.username,
          message: `${broadcasterUser.username} ekran yayınını başlattı`
        });
        setTimeout(() => setScreenShareNotification(null), 4000);
      } else {
        webrtc.handleRemoteScreenShareEnded(userId);
        setEndedBroadcast({
          broadcasterName: broadcasterUser.username,
          stoppedAt: Date.now()
        });
        setScreenShareNotification({
          type: 'stopped',
          userName: broadcasterUser.username,
          message: `${broadcasterUser.username} ekran yayınını durdurdu.`
        });
        setTimeout(() => setScreenShareNotification(null), 6000);
      }
      setPeers({ ...webrtc.peers });
    };

    webrtc.onRemoteScreenShareStopped = (peerId) => {
      const broadcasterUser = allUsers.find(u => u.id === peerId || u.socketId === peerId) || { username: 'Arkadaşın' };
      setEndedBroadcast({
        broadcasterName: broadcasterUser.username,
        stoppedAt: Date.now()
      });
      setPeers({ ...webrtc.peers });
    };

    realtimeSignaling.onQualityRequest = (viewerId, requestedQuality) => {
      webrtc.setVideoQualityForPeer(viewerId, requestedQuality);
    };

    return () => {
      realtimeSignaling.destroy();
    };
  }, [currentUser?.id]);

  // 4. Socket & WebRTC setup (Local & Fallback)
  useEffect(() => {
    // Güvenlik: Oturum açılmadan veya hesap oluşturulmadan Socket bağlantısı kurulmaz
    if (!currentUser) {
      if (socket.connected) socket.disconnect();
      return;
    }

    socket.connect();

    socket.on('connect', () => {
      socket.emit('user:join', currentUser);
    });

    socket.on('init:state', (state) => {
      setChannels(prev => ({
        text: state.channels?.text || prev.text,
        voice: mergeVoiceChannels(prev.voice, state.channels?.voice)
      }));
      setAllUsers(state.users);
      setVoiceRooms(prev => ({ ...state.voiceRooms, ...prev }));
      setMessages(state.messages || {});
    });

    socket.on('channels:updated', (updatedChannels) => {
      setChannels(prev => ({
        text: updatedChannels.text || prev.text,
        voice: mergeVoiceChannels(prev.voice, updatedChannels.voice)
      }));
    });

    socket.on('room:created', (newRoom) => {
      handleJoinVoiceChannel(newRoom.id);
    });

    socket.on('users:updated', (usersList) => {
      setAllUsers(usersList);
      if (currentUser?.username) {
        const me = usersList.find(u => (currentUser.id && (u.id === currentUser.id || u.socketId === socket.id)) || u.username === currentUser.username);
        if (me) {
          setCurrentUser(prev => prev ? ({
            ...prev,
            currentVoiceRoom: me.currentVoiceRoom,
            isMuted: me.isMuted,
            isDeafened: me.isDeafened,
            isScreenSharing: me.isScreenSharing
          }) : null);
        }
      }
    });

    socket.on('friend:request-received', ({ fromUser }) => {
      setPendingFriendCount(prev => prev + 1);
      setIncomingFriendToast({
        type: 'request',
        text: `${fromUser.username} size arkadaşlık isteği gönderdi!`,
        fromUser
      });
      setTimeout(() => setIncomingFriendToast(null), 8000);
    });

    socket.on('friend:respond-received', ({ fromUser, accepted }) => {
      if (accepted) {
        setIncomingFriendToast({
          type: 'accepted',
          text: `${fromUser.username} arkadaşlık isteğinizi kabul etti! 🎉`,
          fromUser
        });
        setTimeout(() => setIncomingFriendToast(null), 8000);
      }
    });

    socket.on('voice:rooms-updated', (roomsData) => {
      setVoiceRooms(prev => ({ ...roomsData, ...prev }));
    });

    socket.on('chat:message', (newMsg) => {
      setMessages(prev => ({
        ...prev,
        [newMsg.channelId]: [...(prev[newMsg.channelId] || []).filter(m => m.id !== newMsg.id), newMsg]
      }));
    });

    socket.on('voice:peers', async ({ roomId, peers: existingPeers }) => {
      for (const p of existingPeers) {
        await webrtc.createPeerConnection(p.id, true);
      }
    });

    socket.on('voice:user-joined', async ({ roomId, peer }) => {
      if (peer && peer.id && peer.id !== socket.id) {
        if (activeVoiceChannelRef.current === roomId) {
          soundEffects.playUserJoined();
          setRoomEventToast({
            type: 'join',
            text: `${peer.username || 'Birisi'} odaya katıldı 👋`,
            user: peer
          });
          setTimeout(() => setRoomEventToast(null), 4500);
        }
        await webrtc.createPeerConnection(peer.id, false);
      }
    });

    socket.on('voice:user-left', ({ peerId }) => {
      webrtc.closePeer(peerId);
      soundEffects.playUserLeft();
      setSpeakingUsers(prev => {
        const copy = { ...prev };
        delete copy[peerId];
        return copy;
      });
    });

    socket.on('voice:screenshare-updated', ({ peerId, isSharing }) => {
      const broadcasterUser = allUsers.find(u => u.id === peerId || u.socketId === peerId) || { username: 'Arkadaşın' };
      if (!isSharing) {
        webrtc.handleRemoteScreenShareEnded(peerId);
        setEndedBroadcast({
          broadcasterName: broadcasterUser.username,
          stoppedAt: Date.now()
        });
      } else {
        setEndedBroadcast(null);
      }
      setPeers({ ...webrtc.peers });
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

    // Admin Socket Dinleyicileri
    socket.on('admin:kicked', ({ reason }) => {
      handleLeaveVoice();
      setAdminNoticeModal({
        title: 'Odadan Çıkarıldınız',
        message: reason || 'Yönetici tarafından ses odasından çıkarıldınız.',
        icon: '👢'
      });
    });

    socket.on('admin:force-muted', ({ isMuted }) => {
      setIsForceMuted(Boolean(isMuted));
      if (isMuted) {
        webrtc.toggleMute(true);
        setCurrentUser(prev => ({ ...prev, isMuted: true }));
        setAdminNoticeModal({
          title: 'Sessize Alındınız',
          message: 'Yönetici tarafından mikrofonunuz kapatıldı.',
          icon: '🔇'
        });
      } else {
        setAdminNoticeModal({
          title: 'Ses Kilidi Açıldı',
          message: 'Yönetici mikrofon kilidinizi açtı.',
          icon: '🔊'
        });
      }
    });

    socket.on('admin:deactivated', async ({ message }) => {
      if (currentUser?.email?.toLowerCase() !== 'aerayyoruk@gmail.com') {
        handleLeaveVoice();
        if (socket.connected) socket.disconnect();
        await supabase.auth.signOut();
        setCurrentUser(null);
        setAdminNoticeModal({
          title: 'Hesabınız Pasife Alındı',
          message: message || 'Hesabınız yönetici tarafından pasife alınmıştır.',
          icon: '🚫'
        });
      }
    });

    webrtc.onSpeakingChange = (id, isSpeaking) => {
      const myId = currentUser?.id || 'self';
      setSpeakingUsers(prev => ({ ...prev, [myId]: isSpeaking }));
      realtimeSignaling.sendSpeaking(isSpeaking);
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
      socket.off('channels:updated');
      socket.off('room:created');
      socket.off('users:updated');
      socket.off('voice:rooms-updated');
      socket.off('chat:message');
      socket.off('voice:peers');
      socket.off('voice:user-joined');
      socket.off('voice:user-left');
      socket.off('webrtc:offer');
      socket.off('webrtc:answer');
      socket.off('webrtc:ice-candidate');
      socket.off('voice:peer-speaking');
      socket.off('admin:kicked');
      socket.off('admin:force-muted');
      socket.off('admin:deactivated');
    };
  }, [currentUser]);

  const handleJoinVoiceChannel = async (roomId) => {
    if (activeVoiceChannel === roomId) {
      setActiveTab('voice');
      return;
    }

    // Odadan odaya geçerken eski odadaki bağlantıları ve varlığı eksiksiz temizle
    if (activeVoiceChannel) {
      console.log('[Voice] Leaving current voice room before switching:', activeVoiceChannel);
      handleLeaveVoice();
      await new Promise(r => setTimeout(r, 200));
    }

    try {
      soundEffects.playSelfJoin();

      // Seed initial room members so we don't trigger "user joined" for existing occupants
      const existingInRoom = voiceRooms[roomId] || [];
      const initialIds = new Set(existingInRoom.map(u => u.id));
      if (currentUser?.id) initialIds.add(currentUser.id);
      prevRoomMembersRef.current = initialIds;

      await webrtc.initLocalAudio();
      setActiveVoiceChannel(roomId);
      setActiveTab('voice');

      // 1. Cloud presence update (Instant broadcast to all users)
      await realtimeSignaling.setVoiceRoom(roomId);

      // 2. Also emit to socket if connected
      if (socket && socket.connected) {
        socket.emit('voice:join', { roomId });
      }

      // 3. Connect to existing peers in this room via WebRTC!
      const currentRoomMembers = voiceRooms[roomId] || [];
      for (const p of currentRoomMembers) {
        if (p.id && p.id !== currentUser?.id) {
          console.log('[WebRTC] Calling existing peer in room:', p.username, p.id);
          if (webrtc.peers[p.id]) {
            webrtc.closePeer(p.id);
          }
          await webrtc.createPeerConnection(p.id, true);
        }
      }
    } catch (err) {
      alert('Mikrofon erişimi reddedildi: ' + (err.message || ''));
    }
  };

  const handleLeaveVoice = () => {
    soundEffects.playSelfLeave();
    prevRoomMembersRef.current = new Set();
    webrtc.leaveRoom();
    setActiveVoiceChannel(null);
    setIsScreenSharing(false);
    setScreenStream(null);
    setEndedBroadcast(null);

    realtimeSignaling.setVoiceRoom(null);

    if (socket && socket.connected) {
      socket.emit('voice:leave');
    }
  };

  const handleToggleMute = () => {
    if (isForceMuted) {
      setAdminNoticeModal({
        title: 'Mikrofon Kilitli',
        message: 'Yönetici tarafından sistem genelinde susturulduğunuz için mikrofonunuzu açamazsınız.',
        icon: '🔇'
      });
      return;
    }
    const isMuted = webrtc.toggleMute();
    setCurrentUser(prev => ({ ...prev, isMuted }));
    realtimeSignaling.setAudioState(isMuted, webrtc.isDeafened);
  };

  const handleToggleDeafen = () => {
    const isDeafened = webrtc.toggleDeafen();
    setCurrentUser(prev => ({ ...prev, isDeafened, isMuted: webrtc.isMuted }));
    realtimeSignaling.setAudioState(webrtc.isMuted, isDeafened);
  };

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      webrtc.stopScreenShare();
      setIsScreenSharing(false);
      setScreenStream(null);
      setEndedBroadcast(null);
      setPeers({ ...webrtc.peers });
    } else {
      setEndedBroadcast(null);
      const stream = await webrtc.startScreenShare(viewerResolution);
      if (stream) {
        setIsScreenSharing(true);
        setScreenStream(stream);
        setPeers({ ...webrtc.peers });
      }
    }
  };

  const handleSelectViewerResolution = (quality) => {
    setViewerResolution(quality);
    if (isScreenSharing) {
      // Outgoing: apply to all peer connections
      for (const peerId of Object.keys(peers)) {
        webrtc.setVideoQualityForPeer(peerId, quality);
      }
    } else {
      // Incoming: request broadcaster to stream at this bitrate
      for (const [peerId, peer] of Object.entries(peers)) {
        if (peer.remoteStream && peer.remoteStream.getVideoTracks().length > 0) {
          realtimeSignaling.sendQualityRequest(peerId, quality);
        }
      }
    }
  };

  const handleSendMessage = (text) => {
    if (!text || !text.trim()) return;

    const newMsg = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      channelId: activeTextChannel,
      sender: {
        id: currentUser?.id,
        username: currentUser?.username || 'Oyuncu',
        avatar: currentUser?.avatar || '🎮'
      },
      text: text.trim(),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => ({
      ...prev,
      [activeTextChannel]: [...(prev[activeTextChannel] || []).filter(m => m.id !== newMsg.id), newMsg]
    }));

    realtimeSignaling.sendChatMessage(newMsg);

    if (socket && socket.connected) {
      socket.emit('chat:message', {
        channelId: activeTextChannel,
        text
      });
    }
  };

  const handleSignOut = async () => {
    if (activeVoiceChannel) handleLeaveVoice();
    await supabase.auth.signOut();
    if (socket.connected) socket.disconnect();
    setCurrentUser(null);
    setSession(null);
    setFriendsSet(new Set());
    setPendingSentRequests(new Set());
    setMessages({});
    setChannels({ text: [], voice: [] });
    setVoiceRooms({});
    setAllUsers([]);
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

  const handleRoomClick = (room) => {
    // If room is locked, user is not the creator, and hasn't unlocked it yet this session
    if (room.hasPassword && room.created_by !== currentUser?.id && !unlockedRooms[room.id]) {
      setPasswordPromptRoom(room);
      setPasswordInput('');
      setPasswordError('');
      return;
    }
    handleJoinVoiceChannel(room.id);
  };

  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (!passwordPromptRoom) return;

    if (passwordInput.trim() === passwordPromptRoom.password) {
      setUnlockedRooms(prev => ({ ...prev, [passwordPromptRoom.id]: true }));
      const targetRoomId = passwordPromptRoom.id;
      setPasswordPromptRoom(null);
      setPasswordInput('');
      setPasswordError('');
      handleJoinVoiceChannel(targetRoomId);
    } else {
      setPasswordError('Hatalı şifre! Lütfen şifrenizi kontrol edip tekrar deneyin.');
    }
  };

  // Create room submit (Saves permanently to Supabase & notifies all peers)
  const handleCreateRoomSubmit = async (e) => {
    e.preventDefault();
    if (!newRoomName.trim()) return;

    const roomId = `room-${Date.now()}`;
    const cleanName = newRoomName.trim();
    const roomLimit = parseInt(newRoomLimit, 10) || 5;
    const roomPassword = (newRoomIsPassword && newRoomPassword.trim()) ? newRoomPassword.trim() : null;

    // 1. Save permanently to Supabase
    try {
      const dbPayload = {
        id: roomId,
        name: roomPassword ? `${cleanName}:::pwd:::${roomPassword}` : cleanName,
        limit_count: roomLimit,
        created_by: currentUser?.id
      };

      const { error: insertErr } = await supabase.from('voice_rooms').insert({
        ...dbPayload,
        password: roomPassword
      });

      if (insertErr) {
        // Fallback without password column
        await supabase.from('voice_rooms').insert(dbPayload);
      }
    } catch (err) {
      console.warn('voice_rooms insert err:', err);
    }

    // 2. Update local state immediately
    const newRoomObj = parseRoomData({
      id: roomId,
      name: cleanName,
      limit: roomLimit,
      limit_count: roomLimit,
      created_by: currentUser?.id,
      password: roomPassword
    });

    setUnlockedRooms(prev => ({ ...prev, [roomId]: true }));

    setChannels(prev => ({
      ...prev,
      voice: [...prev.voice.filter(v => v.id !== roomId), newRoomObj]
    }));

    // 3. Broadcast to all users
    realtimeSignaling.sendRoomUpdated(newRoomObj);

    if (socket && socket.connected) {
      socket.emit('room:create', newRoomObj);
    }

    setNewRoomName('');
    setNewRoomPassword('');
    setNewRoomIsPassword(false);
    setShowCreateRoom(false);

    // 4. Immediately join the created room
    handleJoinVoiceChannel(roomId);
  };

  // Edit room submit
  const handleEditRoomSubmit = async (e) => {
    e.preventDefault();
    if (!editingRoom || !editingRoom.name.trim()) return;

    const roomId = editingRoom.id;
    const cleanName = editingRoom.name.trim();
    const roomLimit = parseInt(editingRoom.limit, 10) || 5;
    const roomPassword = (editingRoom.hasPassword && editingRoom.password?.trim()) ? editingRoom.password.trim() : null;

    const updatePayload = {
      name: roomPassword ? `${cleanName}:::pwd:::${roomPassword}` : cleanName,
      limit_count: roomLimit
    };

    try {
      const { error } = await supabase
        .from('voice_rooms')
        .update({
          ...updatePayload,
          password: roomPassword
        })
        .eq('id', roomId);

      if (error) {
        // Fallback without password column
        await supabase
          .from('voice_rooms')
          .update(updatePayload)
          .eq('id', roomId);
      }
    } catch (err) {
      console.warn('Edit room error:', err);
    }

    const updatedRoomObj = parseRoomData({
      id: roomId,
      name: cleanName,
      limit: roomLimit,
      limit_count: roomLimit,
      created_by: editingRoom.created_by,
      password: roomPassword
    });

    setChannels(prev => ({
      ...prev,
      voice: prev.voice.map(v => v.id === roomId ? { ...v, ...updatedRoomObj } : v)
    }));

    realtimeSignaling.sendRoomUpdated(updatedRoomObj);

    if (socket && socket.connected) {
      socket.emit('room:updated', updatedRoomObj);
    }

    setEditingRoom(null);
  };

  // Delete room
  const handleDeleteRoom = async (roomToDelete) => {
    if (!confirm(`"${roomToDelete.name}" odasını kalıcı olarak silmek istediğinizden emin misiniz?`)) {
      return;
    }

    const roomId = roomToDelete.id;

    if (activeVoiceChannel === roomId) {
      handleLeaveVoice();
    }

    try {
      await supabase
        .from('voice_rooms')
        .delete()
        .eq('id', roomId);
    } catch (err) {
      console.warn('Delete room error:', err);
    }

    setChannels(prev => ({
      ...prev,
      voice: prev.voice.filter(v => v.id !== roomId)
    }));

    realtimeSignaling.sendRoomDeleted(roomId);

    if (socket && socket.connected) {
      socket.emit('room:deleted', { id: roomId });
    }
  };

  // Accept incoming room invite
  const handleAcceptInvite = async () => {
    if (!incomingInvite) return;
    const targetRoomId = incomingInvite.room_id;
    try {
      await supabase
        .from('room_invites')
        .update({ status: 'accepted' })
        .eq('id', incomingInvite.id);
    } catch (e) {
      console.warn('Invite accept error:', e);
    }

    setIncomingInvite(null);

    // Başka bir odadaysa önce o odadan düş ve temizlen
    if (activeVoiceChannel && activeVoiceChannel !== targetRoomId) {
      handleLeaveVoice();
      await new Promise(r => setTimeout(r, 200));
    }

    await handleJoinVoiceChannel(targetRoomId);
  };

  const handleDeclineInvite = async () => {
    if (!incomingInvite) return;
    await supabase
      .from('room_invites')
      .update({ status: 'declined' })
      .eq('id', incomingInvite.id);

    setIncomingInvite(null);
  };

  // Güvenlik Kapısı 1: Oturum kontrolü devam ederken DOM'a hiçbir kanal/mesaj yüklenmez
  if (isAuthLoading) {
    return (
      <div 
        onContextMenu={(e) => e.preventDefault()} 
        className="h-screen w-screen bg-[#0d1117] flex flex-col items-center justify-center space-y-4 select-none"
      >
        <TurkCordLogo size={68} className="animate-pulse drop-shadow-2xl" />
        <div className="flex items-center space-x-2 text-sm text-[#7d8590]">
          <div className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
          <span>Güvenli Oturum Başlatılıyor...</span>
        </div>
      </div>
    );
  }

  // Güvenlik Kapısı 2: Kullanıcı giriş yapmamış veya hesabı yoksa ana panel, kanallar ve mesajlar DOM'da dahi bulunmaz
  if (!currentUser) {
    return (
      <div 
        onContextMenu={(e) => e.preventDefault()} 
        className="h-screen w-screen bg-[#0d1117] flex items-center justify-center relative select-none"
      >
        <AuthModal 
          onAuthSuccess={(user) => {
            setCurrentUser(user);
            loadFriendsData(user.id);
            loadPendingFriendCount(user.id);
            if (socket.connected) socket.emit('user:join', user);
          }} 
        />
      </div>
    );
  }

  const currentVoiceRoomUsers = activeVoiceChannel ? (voiceRooms[activeVoiceChannel] || []) : [];
  const currentVoiceObj = channels.voice?.find(v => v.id === activeVoiceChannel);
  const currentTextObj = channels.text?.find(c => c.id === activeTextChannel) || channels.text?.[0];

  return (
    <div 
      onContextMenu={(e) => e.preventDefault()} 
      className="flex h-screen w-screen overflow-hidden bg-[#0d1117] text-[#e6edf3] font-sans antialiased relative select-none"
    >
      {/* Canlı Oda Daveti Bildirimi (Floating Toast) */}
      {incomingInvite && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 bg-[#161b22] border-2 border-emerald-500 rounded-2xl p-4 shadow-2xl flex items-center space-x-4 animate-bounce-subtle">
          <div className="text-3xl">{incomingInvite.senderAvatar}</div>
          <div>
            <div className="text-sm font-bold text-white">
              {incomingInvite.senderName} seni ses odasına davet ediyor!
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

      {/* Arkadaşlık İsteği / Kabulü Toast Bildirimi */}
      {incomingFriendToast && (
        <div className="absolute top-5 right-5 z-50 bg-[#161b22] border-2 border-indigo-500 rounded-2xl p-4 shadow-2xl flex items-center space-x-3.5 animate-bounce">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500 flex items-center justify-center text-xl flex-shrink-0">
            {incomingFriendToast.fromUser?.avatar || '🎉'}
          </div>
          <div>
            <div className="text-sm font-bold text-white">
              {incomingFriendToast.text}
            </div>
            <div className="text-[11px] text-indigo-400 font-medium">
              Arkadaşlar sekmesinden istekleri görüntüleyebilirsiniz
            </div>
          </div>
          <div className="flex items-center space-x-2 pl-2">
            <button
              onClick={() => {
                setActiveTab('friends');
                setIncomingFriendToast(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition shadow"
            >
              Arkadaşlar'a Git
            </button>
            <button
              onClick={() => setIncomingFriendToast(null)}
              className="p-1.5 rounded-xl bg-[#30363d] text-[#7d8590] hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Odaya Biri Katıldı / Ayrıldı Toast Bildirimi */}
      {roomEventToast && (
        <div className="absolute top-5 right-5 z-50 bg-[#161b22] border-2 border-emerald-500/50 rounded-2xl px-4 py-3 shadow-2xl flex items-center space-x-3 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-lg">
            {roomEventToast.type === 'join' ? '👋' : '🚪'}
          </div>
          <div>
            <div className="text-xs font-bold text-white">
              {roomEventToast.text}
            </div>
            <div className="text-[10px] text-[#7d8590]">
              Ses Odası Bildirimi
            </div>
          </div>

          {/* Odaya katılan kişiyle arkadaş değilsek doğrudan istek gönderme butonu */}
          {roomEventToast.type === 'join' && roomEventToast.user && roomEventToast.user.id !== currentUser?.id && (
            <div className="pl-2 border-l border-[#30363d] ml-1 flex-shrink-0">
              {friendsSet.has(roomEventToast.user.id) ? (
                <span className="flex items-center space-x-1 text-[10px] font-bold text-emerald-400 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                  <Check className="w-3 h-3" />
                  <span>Arkadaşsınız</span>
                </span>
              ) : pendingSentRequests.has(roomEventToast.user.id) ? (
                <span className="flex items-center space-x-1 text-[10px] font-bold text-amber-400 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <Clock className="w-3 h-3" />
                  <span>İstek Gönderildi</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendFriendRequestFromRoom(roomEventToast.user)}
                  className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md transition transform hover:scale-105 active:scale-95"
                  title={`${roomEventToast.user.username} kişisine arkadaşlık isteği gönder`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Arkadaş Ekle</span>
                </button>
              )}
            </div>
          )}
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
              <TurkCordLogo size={36} className="drop-shadow-md" />
              <div>
                <h1 className="text-base font-extrabold text-white leading-tight">TurkCord</h1>
                <p className="text-[11px] text-[#7d8590]">Sıfır Gecikmeli Ses & Sohbet</p>
              </div>
            </div>

            <div className="flex items-center space-x-1.5">
              {!isStandaloneApp && (
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition shadow-sm"
                  title="TurkCord'u Masaüstü Uygulaması Olarak İndir / Yükle"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden sm:inline">İndir</span>
                </button>
              )}

              {isStandaloneApp && (
                <div
                  className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold"
                  title="Masaüstü Uygulaması Olarak Çalışıyor"
                >
                  <Laptop className="w-3 h-3" />
                  <span>Masaüstü</span>
                </div>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAdminPanel(true)}
                  className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-black transition shadow-sm"
                  title="TurkCord Yönetim Paneli (Süper Admin: aerayyoruk@gmail.com)"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">Admin</span>
                </button>
              )}

              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-xl text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
                title="Ayarlar"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Admin Banner (aerayyoruk@gmail.com) */}
          {isAdmin && (
            <div className="px-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAdminPanel(true)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500/25 via-amber-600/35 to-amber-500/25 border border-amber-500/60 hover:border-amber-400 text-amber-300 hover:text-white transition shadow-lg group"
                title="TurkCord Yönetim Paneli (aerayyoruk@gmail.com)"
              >
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-500 text-black flex items-center justify-center font-black shadow group-hover:scale-105 transition">
                    <ShieldAlert className="w-3.5 h-3.5" />
                  </div>
                  <div className="text-left">
                    <span className="text-xs font-black tracking-wide block text-amber-300 leading-tight">YÖNETİCİ PANELİ</span>
                    <span className="text-[10px] text-amber-200/70 font-medium block leading-tight">Süper Admin Modu</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-lg bg-amber-500 text-black text-[10px] font-black uppercase">
                  AÇ
                </span>
              </button>
            </div>
          )}

          {/* 3 Net Sekme: Ses Odaları | Metin | Kadro */}
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
                className={`flex-1 flex items-center justify-center space-x-1 py-2 rounded-lg text-xs font-bold transition relative ${
                  activeTab === 'friends'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-[#7d8590] hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Arkadaşlar</span>
                {pendingFriendCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                    {pendingFriendCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Liste İçeriği */}
          <div className="px-3 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
            {activeTab === 'voice' && (
              // 1. SES ODALARI LİSTESİ + ODA OLUŞTURMA
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between px-2">
                  <span className="text-[11px] font-bold text-[#7d8590] uppercase tracking-wider">
                    Ses Odaları
                  </span>

                  <button
                    onClick={() => setShowCreateRoom(!showCreateRoom)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white text-[11px] font-bold transition"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Oda Aç</span>
                  </button>
                </div>

                {/* Oda Oluşturma Formu */}
                {showCreateRoom && (
                  <form onSubmit={handleCreateRoomSubmit} className="p-3.5 rounded-2xl bg-[#21262d] border border-indigo-500/50 space-y-3">
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span className="flex items-center space-x-1.5">
                        <Volume2 className="w-4 h-4 text-indigo-400" />
                        <span>Yeni Ses Odası Aç</span>
                      </span>
                      <button type="button" onClick={() => setShowCreateRoom(false)} className="text-[#7d8590] hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="text"
                      required
                      placeholder="Oda adı (Örn: Valorant Squad)..."
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-3 py-1.5 text-xs text-white outline-none"
                    />

                    <div className="flex items-center justify-between text-xs text-[#7d8590]">
                      <span>Kişi Sınırı:</span>
                      <div className="flex space-x-1">
                        {[2, 5, 10, 20].map((num) => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => setNewRoomLimit(num)}
                            className={`px-2 py-0.5 rounded-lg font-bold text-[11px] ${
                              newRoomLimit === num ? 'bg-indigo-600 text-white' : 'bg-[#0d1117] text-[#7d8590]'
                            }`}
                          >
                            {num}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Şifre Seçeneği */}
                    <div className="pt-2 border-t border-[#30363d]/60 space-y-2">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newRoomIsPassword}
                          onChange={(e) => setNewRoomIsPassword(e.target.checked)}
                          className="rounded border-[#30363d] text-amber-500 focus:ring-0"
                        />
                        <span className="text-xs font-bold text-white flex items-center space-x-1">
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          <span>Şifreli Oda (İsteğe Bağlı)</span>
                        </span>
                      </label>

                      {newRoomIsPassword && (
                        <input
                          type="text"
                          required
                          placeholder="Oda Şifresi / PIN (Örn: 1234)..."
                          value={newRoomPassword}
                          onChange={(e) => setNewRoomPassword(e.target.value)}
                          className="w-full bg-[#0d1117] border border-amber-500/50 rounded-xl px-3 py-1.5 text-xs text-white outline-none"
                        />
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!newRoomName.trim() || (newRoomIsPassword && !newRoomPassword.trim())}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl text-xs transition shadow disabled:opacity-40"
                    >
                      Odayı Başlat
                    </button>
                  </form>
                )}

                {/* Odalar */}
                {channels.voice?.map((v) => {
                  const isCurrent = activeVoiceChannel === v.id;
                  const usersInRoom = voiceRooms[v.id] || [];
                  const isOwner = v.created_by === currentUser?.id || !v.created_by;

                  return (
                    <div
                      key={v.id}
                      onClick={() => handleRoomClick(v)}
                      className={`p-3 rounded-2xl cursor-pointer transition-all border group relative ${
                        isCurrent
                          ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
                          : 'bg-[#21262d]/50 hover:bg-[#21262d] border-[#30363d]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5 truncate">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            isCurrent ? 'bg-emerald-500 text-black' : 'bg-[#30363d] text-white'
                          }`}>
                            {v.hasPassword ? (
                              <Lock className="w-4 h-4 text-amber-400" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </div>
                          <div className="truncate">
                            <div className="text-sm font-bold text-white flex items-center space-x-1.5 truncate">
                              <span className="truncate">{v.name}</span>
                              {v.hasPassword && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 font-semibold flex items-center space-x-0.5">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>Şifreli</span>
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#7d8590]">
                              {usersInRoom.length === 0 ? 'Oda boş' : `${usersInRoom.length}/${v.limit} kişi bağlı`}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-1">
                          {/* Düzenle & Sil Butonları (Oda Sahibi veya Giriş Yapanlar) */}
                          {isOwner && (
                            <div className="hidden group-hover:flex items-center space-x-1 mr-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingRoom({
                                    id: v.id,
                                    name: v.name,
                                    limit: v.limit,
                                    hasPassword: v.hasPassword,
                                    password: v.password || '',
                                    created_by: v.created_by
                                  });
                                }}
                                className="p-1 rounded-lg text-[#7d8590] hover:text-white hover:bg-[#30363d] transition"
                                title="Odayı Düzenle"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRoom(v);
                                }}
                                className="p-1 rounded-lg text-rose-400 hover:text-white hover:bg-rose-500 transition"
                                title="Odayı Sil"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                          {isCurrent ? (
                            <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full animate-pulse">
                              Bağlısın
                            </span>
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#7d8590]" />
                          )}
                        </div>
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
                                {u.id !== currentUser?.id && !friendsSet.has(u.id) && !pendingSentRequests.has(u.id) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSendFriendRequestFromRoom(u);
                                    }}
                                    className="p-0.5 rounded hover:bg-indigo-600 text-indigo-300 hover:text-white transition ml-0.5"
                                    title={`${u.username} kişisine arkadaşlık isteği gönder`}
                                  >
                                    <UserPlus className="w-2.5 h-2.5" />
                                  </button>
                                )}
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
              // 2. METİN KANALLARI
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
              // 3. KADRO & ARKADAŞLAR PANELİ
              <FriendsPanel
                currentUser={currentUser}
                activeVoiceChannel={activeVoiceChannel}
                channels={channels}
                allUsers={allUsers}
                onJoinRoom={handleJoinVoiceChannel}
                socket={socket}
                onPendingCountChange={setPendingFriendCount}
                isAdmin={isAdmin}
                onOpenAdminPanel={() => setShowAdminPanel(true)}
                onKickUser={handleAdminKickUser}
                onToggleMute={handleAdminToggleMute}
                onTogglePassive={handleAdminTogglePassive}
              />
            )}
          </div>
        </div>

        {/* Sol Panel Altı: Kullanıcı Kartı & 10 Haneli ID */}
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

          {/* Profil Bilgisi */}
          <div className="flex items-center justify-between">
            <div 
              onClick={() => setShowSettings(true)}
              className="flex items-center space-x-2.5 cursor-pointer hover:opacity-80 transition truncate max-w-[130px]"
            >
              <div className="relative flex-shrink-0">
                <span className="text-2xl">{currentUser?.avatar || '🎮'}</span>
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-[#161b22] shadow-[0_0_8px_#10b981]" />
              </div>
              <div className="truncate">
                <div className="text-sm font-bold text-white truncate leading-tight flex items-center space-x-1">
                  <span className="truncate">{currentUser?.username || 'Misafir'}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAdminPanel(true);
                      }}
                      className="px-1.5 py-0.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-[9px] font-black flex-shrink-0 flex items-center space-x-0.5 shadow transition"
                      title="Yönetim Panelini Aç"
                    >
                      <ShieldAlert className="w-2.5 h-2.5" />
                      <span>ADMIN</span>
                    </button>
                  )}
                </div>
                <div className="text-[10px] font-mono text-indigo-400 truncate">
                  ID: {currentUser?.user_code || '------'}
                </div>
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
                  <div className="hidden sm:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-bold">
                    <Zap className="w-3.5 h-3.5" />
                    <span>eSports 10ms Opus</span>
                  </div>

                  <div className="flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>{livePing} ms</span>
                  </div>
                </div>
              </div>

              {/* Ekran Paylaşımı Başladı / Durduruldu Bildirim Rozeti */}
              {screenShareNotification && (
                <div className={`my-3 p-3.5 rounded-2xl flex items-center justify-between border animate-in fade-in slide-in-from-top-2 duration-200 shadow-xl ${
                  screenShareNotification.type === 'stopped'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200'
                }`}>
                  <div className="flex items-center space-x-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold ${
                      screenShareNotification.type === 'stopped' ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-500/20 text-indigo-400'
                    }`}>
                      <Tv className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-white">
                        {screenShareNotification.type === 'stopped' ? '📺 Ekran Yayını Durduruldu' : '📺 Canlı Yayın Başladı'}
                      </div>
                      <div className="text-[11px] opacity-80">
                        {screenShareNotification.message}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setScreenShareNotification(null)}
                    className="p-1 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Ekran Paylaşımı Varsa (Yayıncı veya İzleyici) */}
              {(() => {
                if (screenStream) {
                  return (
                    <ScreenSharePlayer
                      stream={screenStream}
                      isLocal={true}
                      broadcasterName={currentUser?.username}
                      currentResolution={viewerResolution}
                      onSelectResolution={handleSelectViewerResolution}
                    />
                  );
                }

                const peerWithVideo = Object.entries(peers).find(([_, p]) =>
                  p.remoteStream && p.remoteStream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted)
                );

                if (peerWithVideo) {
                  const [peerId, peer] = peerWithVideo;
                  const broadcasterUser = allUsers.find(u => u.id === peerId || u.socketId === peerId);
                  return (
                    <ScreenSharePlayer
                      key={peerId}
                      stream={peer.remoteStream}
                      isLocal={false}
                      broadcasterName={broadcasterUser?.username}
                      currentResolution={viewerResolution}
                      onSelectResolution={handleSelectViewerResolution}
                      onStreamEnded={(name) => {
                        setEndedBroadcast({
                          broadcasterName: name || 'Arkadaşın',
                          stoppedAt: Date.now()
                        });
                      }}
                    />
                  );
                }

                if (endedBroadcast && !isScreenSharing) {
                  return (
                    <div className="my-4 relative rounded-3xl overflow-hidden bg-[#161b22] border-2 border-rose-500/40 aspect-video max-h-[52vh] w-full mx-auto flex flex-col items-center justify-center p-8 shadow-2xl text-center animate-in fade-in zoom-in-95 duration-200">
                      <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4 shadow-lg animate-pulse">
                        <Tv className="w-8 h-8" />
                      </div>

                      <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-black tracking-wide uppercase mb-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        <span>Yayın Sonlandı</span>
                      </div>

                      <h3 className="text-2xl font-black text-white tracking-tight">
                        Yayın Durduruldu
                      </h3>

                      <p className="text-sm text-[#7d8590] max-w-md mt-2 font-medium">
                        <strong className="text-white font-bold">{endedBroadcast.broadcasterName}</strong> ekran paylaşımını sonlandırdı.
                      </p>

                      <div className="flex items-center space-x-3 mt-6">
                        <button
                          type="button"
                          onClick={() => setEndedBroadcast(null)}
                          className="px-6 py-2.5 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-white text-xs font-bold transition border border-[#30363d] shadow flex items-center space-x-2"
                        >
                          <X className="w-4 h-4" />
                          <span>Pencereyi Kapat</span>
                        </button>
                      </div>
                    </div>
                  );
                }

                return null;
              })()}

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

                        {/* Arkadaşlık Durumu & İstek Gönderme */}
                        {!isSelf && (
                          <div className="mt-2 flex items-center justify-center">
                            {friendsSet.has(u.id) ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                                <Check className="w-3 h-3" />
                                <span>Arkadaş</span>
                              </span>
                            ) : pendingSentRequests.has(u.id) ? (
                              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-bold">
                                <Clock className="w-3 h-3" />
                                <span>İstek Gönderildi</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSendFriendRequestFromRoom(u);
                                }}
                                className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-bold transition shadow-sm hover:scale-105 active:scale-95"
                                title={`${u.username} kişisine arkadaşlık isteği gönder`}
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                <span>Arkadaş Ekle</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Kişiye Özel Ses Seviyesi Slider'ı (0% - 200%) */}
                        {!isSelf && (
                          <div className="w-full mt-3 pt-2.5 border-t border-[#30363d]/70 px-1">
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleUserMute(u.id);
                                }}
                                className="flex items-center space-x-1 text-[#7d8590] hover:text-white transition group/btn"
                                title={(userVolumes[u.id] ?? 100) === 0 ? "Sesi Aç" : "Bu Kişiyi Sustur"}
                              >
                                {(userVolumes[u.id] ?? 100) === 0 ? (
                                  <VolumeX className="w-3.5 h-3.5 text-rose-400 group-hover/btn:scale-110 transition" />
                                ) : (
                                  <Volume2 className="w-3.5 h-3.5 text-indigo-400 group-hover/btn:scale-110 transition" />
                                )}
                                <span className="font-semibold text-[11px]">Kullanıcı Sesi</span>
                              </button>

                              <span className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded transition ${
                                (userVolumes[u.id] ?? 100) > 100 
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                                  : (userVolumes[u.id] ?? 100) === 0 
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' 
                                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              }`}>
                                %{(userVolumes[u.id] ?? 100)}
                              </span>
                            </div>

                            <input
                              type="range"
                              min="0"
                              max="200"
                              step="5"
                              value={userVolumes[u.id] ?? 100}
                              onChange={(e) => handleUserVolumeChange(u.id, Number(e.target.value))}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full h-1.5 bg-[#0d1117] rounded-lg appearance-none cursor-pointer accent-indigo-500"
                              title={`Ses Düzeyi: %${userVolumes[u.id] ?? 100}`}
                            />
                          </div>
                        )}

                        {/* Admin Hızlı Moderasyon Butonları */}
                        {isAdmin && !isSelf && (
                          <div className="w-full mt-2 pt-2 border-t border-amber-500/30 flex items-center justify-between gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdminKickUser(u);
                              }}
                              className="flex-1 py-1 px-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-black border border-amber-500/40 text-[10px] font-bold transition flex items-center justify-center space-x-1"
                              title="Bu kullanıcıyı odadan at"
                            >
                              <UserMinus className="w-3 h-3" />
                              <span>Odadan At</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdminToggleMute(u, speakingUsers[u.id] === 'muted');
                              }}
                              className="flex-1 py-1 px-1.5 rounded-lg bg-[#21262d] hover:bg-rose-500 text-rose-300 hover:text-white border border-[#30363d] text-[10px] font-bold transition flex items-center justify-center space-x-1"
                              title="Bu kullanıcıyı sistem genelinde sustur"
                            >
                              <MicOff className="w-3 h-3" />
                              <span>Sustur</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdminTogglePassive(u, false);
                              }}
                              className="py-1 px-2 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-[10px] font-bold transition flex items-center justify-center"
                              title="Hesabı pasife çek (giriş yapamaz)"
                            >
                              <Ban className="w-3 h-3" />
                            </button>
                          </div>
                        )}
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
                Arkadaşlarınla konuşmak için sol menüden bir odaya tıkla, kendi odanı aç veya Arkadaşlar sekmesinden arkadaşını davet et.
              </p>
              <div className="flex flex-wrap justify-center gap-3 mt-6">
                <button
                  onClick={() => { setActiveTab('voice'); setShowCreateRoom(true); }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition shadow flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Kendi Odanı Aç</span>
                </button>
                {channels.voice?.slice(0, 3).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => handleJoinVoiceChannel(v.id)}
                    className="px-4 py-2.5 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-white font-bold text-sm transition border border-[#30363d]"
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
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 rounded-3xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center text-4xl mb-4 shadow-xl">
              👥
            </div>
            <h2 className="text-2xl font-black text-white">Arkadaşlar</h2>
            <p className="text-sm text-[#7d8590] max-w-md mt-2">
              Sol paneldeki <b>Arkadaşlar</b> sekmesinden 10 haneli ID ile arkadaşlarını ekleyebilir, çevrimiçi olanları tek tıkla ses odana davet edebilirsin.
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

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          currentUser={currentUser}
          onClose={() => setShowSettings(false)}
          onUpdateUser={handleUpdateProfile}
        />
      )}

      {/* Admin Yönetim Paneli Modalı */}
      {showAdminPanel && isAdmin && (
        <AdminPanelModal
          currentUser={currentUser}
          allUsers={allUsers}
          voiceRooms={voiceRooms}
          channels={channels}
          onClose={() => setShowAdminPanel(false)}
          onKickUser={handleAdminKickUser}
          onToggleMute={handleAdminToggleMute}
          onTogglePassive={handleAdminTogglePassive}
        />
      )}

      {/* Admin Bildirim / Uyarı Modalı */}
      {adminNoticeModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl bg-[#161b22] border-2 border-amber-500/50 p-6 text-center space-y-4 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-3xl mx-auto">
              {adminNoticeModal.icon || '⚠️'}
            </div>
            <h3 className="text-lg font-black text-white">{adminNoticeModal.title}</h3>
            <p className="text-xs text-[#c9d1d9] leading-relaxed bg-[#0d1117] p-3 rounded-xl border border-[#30363d]">
              {adminNoticeModal.message}
            </p>
            <button
              type="button"
              onClick={() => setAdminNoticeModal(null)}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition"
            >
              Tamam
            </button>
          </div>
        </div>
      )}

      {/* Masaüstü Uygulaması Yükleme Modalı (PWA) */}
      {showInstallGuideModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-3xl bg-[#161b22] border border-indigo-500/40 p-6 sm:p-7 space-y-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowInstallGuideModal(false)}
              className="absolute top-5 right-5 p-2 rounded-xl text-[#7d8590] hover:text-white hover:bg-[#21262d] transition"
              title="Kapat"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-4">
              <TurkCordLogo size={56} className="drop-shadow-xl" />
              <div>
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[11px] font-bold mb-1">
                  <Laptop className="w-3 h-3" />
                  <span>Windows / Masaüstü Sürümü</span>
                </div>
                <h3 className="text-xl font-black text-white tracking-tight">TurkCord Masaüstü Uygulaması</h3>
              </div>
            </div>

            <div className="space-y-3 text-sm text-[#c9d1d9] bg-[#0d1117] p-4 rounded-2xl border border-[#30363d]/60">
              <div className="flex items-start space-x-3">
                <span className="text-emerald-400 font-bold">⚡</span>
                <p><strong className="text-white">Bağımsız Pencere:</strong> Tarayıcı sekmelerinden bağımsız, görev çubuğuna ve masaüstüne sabitlenebilen temiz uygulama penceresi.</p>
              </div>
              <div className="flex items-start space-x-3">
                <span className="text-indigo-400 font-bold">🎮</span>
                <p><strong className="text-white">Ultra Düşük Gecikmeli Ses:</strong> Oyun oynarken arka planda minimum kaynak tüketimi ve kesintisiz WebRTC ses akışı.</p>
              </div>
              <div className="flex items-start space-x-3">
                <span className="text-amber-400 font-bold">🚀</span>
                <p><strong className="text-white">Hızlı Başlatma:</strong> Bilgisayarınızı açtığınızda doğrudan masaüstü kısayolundan tek tıkla sohbete katılın.</p>
              </div>
            </div>

            {deferredPrompt ? (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-sm shadow-xl shadow-indigo-600/30 flex items-center justify-center space-x-2 transition transform hover:-translate-y-0.5"
                >
                  <Download className="w-5 h-5" />
                  <span>Şimdi Masaüstüne Yükle (Otomatik)</span>
                </button>
                <p className="text-center text-xs text-[#7d8590]">
                  Chrome, Edge ve Chromium tarayıcıları tek tıkla masaüstü kısayolu oluşturur.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3.5 rounded-2xl bg-[#0d1117] border border-[#30363d] space-y-2">
                  <p className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                    <span>💡</span>
                    <span>Tarayıcıdan Manuel Yükleme Adımları:</span>
                  </p>
                  <ol className="text-xs text-[#8b949e] space-y-1.5 list-decimal list-inside pl-1">
                    <li>Tarayıcınızın adres çubuğunun sağındaki <strong className="text-white">Uygulama Yükle</strong> (veya monitör/indirme) simgesine tıklayın.</li>
                    <li>Veya sağ üstteki <strong className="text-white">üç nokta (⋮)</strong> menüsünden <strong className="text-white">"TurkCord uygulamasını yükle"</strong> seçeneğini seçin.</li>
                    <li>Açılan onay kutusunda <strong className="text-indigo-400 font-bold">"Yükle"</strong> butonuna basın. Masaüstünüze simge eklenecektir!</li>
                  </ol>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallGuideModal(false)}
                  className="w-full py-3 px-4 rounded-2xl bg-[#21262d] hover:bg-[#30363d] text-white font-bold text-sm transition"
                >
                  Anladım, Kapat
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Şifreli Oda Giriş Modalı */}
      {passwordPromptRoom && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handlePasswordSubmit}
            className="w-full max-w-sm rounded-3xl bg-[#161b22] border-2 border-amber-500/60 p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-xl flex-shrink-0">
                <Lock className="w-6 h-6" />
              </div>
              <div className="truncate">
                <h3 className="text-base font-bold text-white leading-tight">Şifreli Oda</h3>
                <p className="text-xs text-[#7d8590] mt-0.5 truncate">{passwordPromptRoom.name}</p>
              </div>
            </div>

            <p className="text-xs text-[#c9d1d9]">
              Bu ses odasına katılmak için oda şifresini giriniz:
            </p>

            <input
              type="password"
              autoFocus
              required
              placeholder="Oda Şifresi..."
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError('');
              }}
              className="w-full bg-[#0d1117] border border-[#30363d] focus:border-amber-500 rounded-xl px-4 py-2.5 text-sm text-white outline-none"
            />

            {passwordError && (
              <div className="text-xs font-semibold text-rose-400 flex items-center space-x-1">
                <span>⚠️</span>
                <span>{passwordError}</span>
              </div>
            )}

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setPasswordPromptRoom(null);
                  setPasswordInput('');
                  setPasswordError('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-xs font-bold text-[#c9d1d9] transition"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={!passwordInput.trim()}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition shadow disabled:opacity-40"
              >
                Odaya Katıl
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Oda Düzenleme Modalı */}
      {editingRoom && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleEditRoomSubmit}
            className="w-full max-w-sm rounded-3xl bg-[#161b22] border-2 border-indigo-500/60 p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5 truncate">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center flex-shrink-0">
                  <Pencil className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <h3 className="text-base font-bold text-white">Odayı Düzenle</h3>
                  <p className="text-xs text-[#7d8590]">Ad, sınır ve şifreyi güncelle</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingRoom(null)}
                className="p-1 rounded-lg text-[#7d8590] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#7d8590]">Oda Adı</label>
              <input
                type="text"
                required
                value={editingRoom.name}
                onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value })}
                className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-[#7d8590]">Kişi Sınırı</label>
              <div className="flex space-x-2">
                {[2, 5, 10, 20].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setEditingRoom({ ...editingRoom, limit: num })}
                    className={`flex-1 py-1.5 rounded-xl font-bold text-xs transition ${
                      editingRoom.limit === num
                        ? 'bg-indigo-600 text-white'
                        : 'bg-[#0d1117] text-[#7d8590] border border-[#30363d]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Şifre Ayarı */}
            <div className="pt-2 border-t border-[#30363d] space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingRoom.hasPassword}
                  onChange={(e) => setEditingRoom({
                    ...editingRoom,
                    hasPassword: e.target.checked,
                    password: e.target.checked ? (editingRoom.password || '') : ''
                  })}
                  className="rounded border-[#30363d] text-amber-500 focus:ring-0"
                />
                <span className="text-xs font-bold text-white flex items-center space-x-1">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Şifreli Oda Olsun</span>
                </span>
              </label>

              {editingRoom.hasPassword && (
                <input
                  type="text"
                  placeholder="Yeni Oda Şifresi (Örn: 1234)..."
                  value={editingRoom.password || ''}
                  onChange={(e) => setEditingRoom({ ...editingRoom, password: e.target.value })}
                  className="w-full bg-[#0d1117] border border-amber-500/50 rounded-xl px-3.5 py-2 text-xs text-white outline-none"
                />
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingRoom(null)}
                className="flex-1 py-2.5 rounded-xl bg-[#21262d] hover:bg-[#30363d] text-xs font-bold text-[#c9d1d9] transition"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={!editingRoom.name.trim()}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
              >
                Kaydet
              </button>
            </div>
          </form>
        </div>
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

function ScreenSharePlayer({ stream, isLocal, broadcasterName, currentResolution, onSelectResolution, onStreamEnded }) {
  const containerRef = React.useRef(null);
  const videoRef = React.useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    if (!stream) {
      setIsEnded(true);
      return;
    }
    const tracks = stream.getVideoTracks();
    if (tracks.length === 0) {
      setIsEnded(true);
      return;
    }

    setIsEnded(false);
    const videoTrack = tracks[0];

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {
        console.warn('[Video] Play interrupted / user gesture needed:', e);
      });
    }

    const handleEnded = () => {
      if (document.fullscreenElement) {
        try { document.exitFullscreen().catch(() => {}); } catch (e) {}
      }
      setIsEnded(true);
      onStreamEnded?.(broadcasterName);
    };

    videoTrack.addEventListener('ended', handleEnded);
    videoTrack.addEventListener('mute', () => {
      setTimeout(() => {
        if (videoTrack.readyState === 'ended' || videoTrack.muted) {
          handleEnded();
        }
      }, 400);
    });

    return () => {
      videoTrack.removeEventListener('ended', handleEnded);
    };
  }, [stream]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const resolutions = [
    { id: 'auto', label: '⚡ Otomatik', desc: 'İnternet Hızına Göre (Max 120 FPS)' },
    { id: '1080p-120', label: '1080p 120 FPS', desc: '🚀 e-Sports Ultra Akıcı (12 Mbps)' },
    { id: '1080p', label: '1080p 60 FPS', desc: 'FHD Kristal Netlik (8 Mbps)' },
    { id: '720p', label: '720p 60 FPS', desc: 'HD Akıcı (4 Mbps)' },
    { id: '480p', label: '480p 30 FPS', desc: 'SD Tasarruf (1.2 Mbps)' },
  ];

  if (isEnded) {
    return (
      <div className="my-4 relative rounded-3xl overflow-hidden bg-[#161b22] border-2 border-rose-500/40 aspect-video max-h-[52vh] w-full mx-auto flex flex-col items-center justify-center p-8 shadow-2xl text-center animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4 shadow-lg animate-pulse">
          <Tv className="w-8 h-8" />
        </div>
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-black tracking-wide uppercase mb-2">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          <span>Yayın Sonlandı</span>
        </div>
        <h3 className="text-2xl font-black text-white tracking-tight">
          Yayın Durduruldu
        </h3>
        <p className="text-sm text-[#7d8590] max-w-md mt-2 font-medium">
          <strong className="text-white font-bold">{broadcasterName || 'Yayıncı'}</strong> ekran paylaşımını sonlandırdı.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`my-4 relative rounded-3xl overflow-hidden bg-black aspect-video max-h-[52vh] mx-auto border-2 border-indigo-500/40 flex items-center justify-center shadow-2xl group transition-all ${
        isFullscreen ? 'w-screen h-screen max-h-screen my-0 rounded-none border-none' : 'w-full'
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-contain cursor-pointer"
        onClick={toggleFullscreen}
      />

      {/* Kontrol Çubuğu */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        {/* Canlı Yayında Rozeti */}
        <div className="flex items-center space-x-2 bg-black/80 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 pointer-events-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-xs font-black text-white">
            {isLocal ? 'Senin Ekran Yayının' : `${broadcasterName || 'Arkadaşın'} Yayında`}
          </span>
        </div>

        {/* Çözünürlük & Tam Ekran Araçları */}
        <div className="flex items-center space-x-2 pointer-events-auto">
          {/* Çözünürlük Seçici Menü */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className="flex items-center space-x-1.5 bg-black/80 hover:bg-[#21262d] text-white text-xs font-bold px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md transition shadow"
              title="Çözünürlük / Kalite Seçimi"
            >
              <Tv className="w-3.5 h-3.5 text-amber-400" />
              <span className="uppercase">{currentResolution || 'Auto'}</span>
            </button>

            {showQualityMenu && (
              <div className="absolute right-0 mt-1.5 w-44 rounded-2xl bg-[#161b22] border border-[#30363d] p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <div className="text-[10px] font-bold text-[#7d8590] uppercase px-2.5 py-1">
                  İzleme Kalitesi
                </div>
                {resolutions.map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => {
                      onSelectResolution?.(res.id);
                      setShowQualityMenu(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-between ${
                      currentResolution === res.id
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-[#c9d1d9] hover:bg-[#21262d]'
                    }`}
                  >
                    <span>{res.label}</span>
                    <span className="text-[10px] opacity-75 font-normal">{res.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tam Ekran Butonu */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-xl bg-black/80 hover:bg-[#21262d] text-white border border-white/10 backdrop-blur-md transition shadow"
            title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran Yap'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
