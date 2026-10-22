import React, { useRef, useEffect, useState } from 'react';
import { webrtc } from '../services/webrtc';
import UserAvatar from './UserAvatar';
import { 
  Mic, 
  MicOff, 
  Headphones, 
  Monitor, 
  PhoneOff, 
  Signal, 
  ChevronLeft,
  Sparkles
} from 'lucide-react';

export default function VoiceRoomView({
  room,
  users,
  currentUser,
  speakingUsers,
  isScreenSharing,
  screenStream,
  peers,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeaveVoice,
  onCloseView
}) {
  const localVideoRef = useRef(null);
  const [livePing, setLivePing] = useState(12);

  // Poll real-time WebRTC ping
  useEffect(() => {
    const interval = setInterval(async () => {
      const ping = await webrtc.getAveragePing();
      if (ping !== null) {
        setLivePing(ping);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Bind local screen share stream
  useEffect(() => {
    if (localVideoRef.current && screenStream) {
      localVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  // Find any remote peers who are currently screen sharing
  const remoteScreenSharingPeers = Object.entries(peers || {}).filter(([peerId, peerData]) => {
    return peerData.remoteStream && peerData.remoteStream.getVideoTracks().length > 0;
  });

  return (
    <main className="flex-1 bg-tc-bg flex flex-col h-full overflow-hidden select-none relative">
      {/* Top Header */}
      <header className="h-14 px-6 border-b border-tc-border flex items-center justify-between flex-shrink-0 bg-tc-panel/80 backdrop-blur z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={onCloseView}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-tc-card hover:bg-tc-cardHover border border-tc-border text-xs font-semibold text-tc-muted hover:text-tc-white transition"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Sohbete Dön</span>
          </button>

          <div className="h-4 w-[1px] bg-tc-border" />

          <div className="flex items-center space-x-2">
            <span className="text-base font-extrabold text-tc-white">{room?.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-tc-card text-tc-muted font-medium border border-tc-border">
              {users.length} Katılımcı
            </span>
          </div>
        </div>

        {/* Live Ping & Quality Indicator */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-tc-green/10 text-tc-green border border-tc-green/30 font-bold">
            <span className="w-2 h-2 rounded-full bg-tc-green animate-ping" />
            <span>{livePing} ms</span>
            <span className="font-normal text-tc-muted hidden sm:inline">(Mükemmel)</span>
          </div>
        </div>
      </header>

      {/* Main Grid: Screen Share + User Cards */}
      <div className="flex-1 p-6 overflow-y-auto flex flex-col justify-center">
        {/* Screen Share Window */}
        {(screenStream || remoteScreenSharingPeers.length > 0) && (
          <div className="mb-6 relative rounded-2xl overflow-hidden bg-black aspect-video max-h-[50vh] mx-auto border-2 border-tc-primary/50 shadow-2xl flex items-center justify-center">
            {screenStream ? (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-contain"
              />
            ) : (
              remoteScreenSharingPeers.map(([peerId, peerData]) => (
                <RemoteVideoPlayer key={peerId} stream={peerData.remoteStream} />
              ))
            )}

            <div className="absolute top-3 left-3 bg-black/80 px-3 py-1 rounded-full text-xs font-bold text-white flex items-center space-x-2 backdrop-blur border border-white/10">
              <span className="w-2 h-2 rounded-full bg-tc-coral animate-ping" />
              <span>{screenStream ? 'Senin Ekran Yayının' : 'Ekran Yayını'}</span>
            </div>
          </div>
        )}

        {/* User Cards Grid */}
        <div className={`grid gap-4 w-full max-w-4xl mx-auto ${
          users.length <= 2 
            ? 'grid-cols-1 md:grid-cols-2' 
            : users.length <= 4 
              ? 'grid-cols-2' 
              : 'grid-cols-2 md:grid-cols-3'
        }`}>
          {users.map((u) => {
            const isSelf = u.id === currentUser?.id;
            const isSpeaking = speakingUsers[u.id];

            return (
              <div
                key={u.id}
                className={`relative aspect-[4/3] rounded-3xl bg-tc-card border-2 transition-all duration-200 flex flex-col items-center justify-center overflow-hidden shadow-md ${
                  isSpeaking
                    ? 'border-tc-green shadow-lg shadow-emerald-500/20 scale-[1.02]'
                    : 'border-tc-border hover:border-tc-borderLight'
                }`}
              >
                {/* Big Avatar */}
                <div className="relative mb-2">
                  <div
                    className={`w-24 h-24 rounded-3xl bg-tc-panel flex items-center justify-center text-5xl transition-all duration-200 overflow-hidden ${
                      isSpeaking ? 'ring-4 ring-tc-green ring-offset-4 ring-offset-tc-card scale-105' : ''
                    }`}
                  >
                    <UserAvatar avatar={u.avatar} className="w-full h-full rounded-3xl" textClassName="text-5xl" />
                  </div>

                  {/* Pulsing Speaking Wave */}
                  {isSpeaking && (
                    <div className="absolute -inset-1 rounded-3xl border-2 border-tc-green animate-ping opacity-60 pointer-events-none" />
                  )}
                </div>

                {/* Animated Equalizer when speaking */}
                {isSpeaking ? (
                  <div className="flex items-end h-3 mb-1">
                    <span className="sound-bar" />
                    <span className="sound-bar" />
                    <span className="sound-bar" />
                    <span className="sound-bar" />
                  </div>
                ) : (
                  <div className="h-3 mb-1" />
                )}

                {/* Bottom User Pill */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between bg-tc-panel/90 border border-tc-border px-3 py-1.5 rounded-xl text-xs backdrop-blur">
                  <span className="font-bold text-tc-white truncate">
                    {u.username} {isSelf && '(Sen)'}
                  </span>

                  <div className="flex items-center space-x-1.5 flex-shrink-0">
                    {u.isMuted ? (
                      <MicOff className="w-3.5 h-3.5 text-tc-coral" />
                    ) : (
                      <Mic className="w-3.5 h-3.5 text-tc-muted" />
                    )}
                    {u.isDeafened && (
                      <Headphones className="w-3.5 h-3.5 text-tc-amber" />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Bottom Action Bar */}
      <footer className="h-20 bg-tc-panel/90 border-t border-tc-border flex items-center justify-center space-x-3 px-6 flex-shrink-0 backdrop-blur z-10">
        {/* Mic Toggle */}
        <button
          onClick={onToggleMute}
          title={currentUser?.isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
          className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all shadow-md active:scale-95 ${
            currentUser?.isMuted
              ? 'bg-tc-coral hover:bg-rose-600 text-white'
              : 'bg-tc-card hover:bg-tc-cardHover border border-tc-border text-white'
          }`}
        >
          {currentUser?.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-tc-green" />}
          <span>{currentUser?.isMuted ? 'Susturuldu' : 'Mikrofon'}</span>
        </button>

        {/* Deafen Toggle */}
        <button
          onClick={onToggleDeafen}
          title={currentUser?.isDeafened ? 'Kulaklığı Aç' : 'Kulaklığı Kapat'}
          className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all shadow-md active:scale-95 ${
            currentUser?.isDeafened
              ? 'bg-tc-amber hover:bg-amber-600 text-white'
              : 'bg-tc-card hover:bg-tc-cardHover border border-tc-border text-white'
          }`}
        >
          <Headphones className="w-5 h-5" />
          <span>{currentUser?.isDeafened ? 'Sağırlaştırıldı' : 'Kulaklık'}</span>
        </button>

        {/* Screen Share Toggle */}
        <button
          onClick={onToggleScreenShare}
          title="Ekran Paylaş"
          className={`flex items-center space-x-2 px-5 py-3 rounded-2xl font-bold text-sm transition-all shadow-md active:scale-95 ${
            isScreenSharing
              ? 'bg-tc-green hover:bg-emerald-600 text-white'
              : 'bg-tc-card hover:bg-tc-cardHover border border-tc-border text-white'
          }`}
        >
          <Monitor className="w-5 h-5" />
          <span>{isScreenSharing ? 'Yayını Durdur' : 'Ekran Paylaş'}</span>
        </button>

        {/* Disconnect Voice */}
        <button
          onClick={onLeaveVoice}
          title="Odadan Ayrıl"
          className="flex items-center space-x-2 px-6 py-3 rounded-2xl font-bold text-sm bg-tc-coral hover:bg-rose-600 text-white transition-all shadow-md active:scale-95"
        >
          <PhoneOff className="w-5 h-5" />
          <span>Ayrıl</span>
        </button>
      </footer>
    </main>
  );
}

function RemoteVideoPlayer({ stream }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      className="w-full h-full object-contain"
    />
  );
}
