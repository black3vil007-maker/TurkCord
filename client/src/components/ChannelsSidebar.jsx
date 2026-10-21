import React from 'react';
import { 
  Hash, 
  Volume2, 
  ChevronDown, 
  Mic, 
  MicOff, 
  Headphones, 
  Settings, 
  PhoneOff, 
  Radio, 
  Monitor,
  Sparkles,
  Gamepad
} from 'lucide-react';
import UserAvatar from './UserAvatar';

export default function ChannelsSidebar({
  channels,
  activeTextChannel,
  onSelectTextChannel,
  activeVoiceChannel,
  onJoinVoiceChannel,
  onLeaveVoiceChannel,
  voiceRooms,
  currentUser,
  speakingUsers,
  onToggleMute,
  onToggleDeafen,
  onOpenSettings,
  onOpenVoiceView,
  isVoiceViewActive
}) {
  return (
    <aside className="w-60 bg-tc-panel border-r border-tc-border flex flex-col justify-between select-none flex-shrink-0">
      {/* Server Header */}
      <div>
        <div className="h-14 px-4 border-b border-tc-border flex items-center justify-between font-bold text-tc-white hover:bg-tc-card/50 cursor-pointer transition">
          <div className="flex items-center space-x-2 truncate">
            <span className="text-lg">🇹🇷</span>
            <span className="truncate text-base font-extrabold tracking-tight">TurkCord</span>
          </div>
          <ChevronDown className="w-4 h-4 text-tc-muted" />
        </div>

        {/* Channels List */}
        <div className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-175px)]">
          {/* Metin Kanalları */}
          <div>
            <div className="px-2 mb-1 flex items-center justify-between text-[11px] font-bold text-tc-muted uppercase tracking-wider">
              <span>Metin Kanalları</span>
            </div>

            <div className="space-y-0.5">
              {channels.text?.map((c) => {
                const isActive = activeTextChannel === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelectTextChannel(c.id)}
                    className={`w-full flex items-center px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all group ${
                      isActive
                        ? 'bg-tc-primary text-white font-semibold shadow-sm'
                        : 'text-tc-muted hover:bg-tc-card hover:text-tc-text'
                    }`}
                  >
                    <Hash className={`w-4 h-4 mr-1.5 flex-shrink-0 ${isActive ? 'text-white' : 'text-tc-muted group-hover:text-tc-text'}`} />
                    <span className="truncate">{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ses Kanalları */}
          <div>
            <div className="px-2 mb-1 flex items-center justify-between text-[11px] font-bold text-tc-muted uppercase tracking-wider">
              <span>Ses Kanalları</span>
            </div>

            <div className="space-y-1">
              {channels.voice?.map((v) => {
                const isCurrentVoice = activeVoiceChannel === v.id;
                const connectedUsers = voiceRooms[v.id] || [];

                return (
                  <div key={v.id} className="space-y-1">
                    <button
                      onClick={() => onJoinVoiceChannel(v.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-sm font-medium transition-all group ${
                        isCurrentVoice
                          ? 'bg-tc-green/15 text-tc-green font-bold border border-tc-green/30'
                          : 'text-tc-muted hover:bg-tc-card hover:text-tc-text'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <Volume2 className={`w-4 h-4 flex-shrink-0 ${isCurrentVoice ? 'text-tc-green' : 'text-tc-muted group-hover:text-tc-text'}`} />
                        <span className="truncate">{v.name}</span>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        {v.limit > 0 && connectedUsers.length >= v.limit && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                            DOLU
                          </span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-tc-card text-tc-muted font-mono">
                          {connectedUsers.length}/{v.limit}
                        </span>
                      </div>
                    </button>

                    {/* Connected Users inside channel */}
                    {connectedUsers.length > 0 && (
                      <div className="pl-6 pr-1 space-y-1 py-0.5">
                        {connectedUsers.map((u) => {
                          const isSpeaking = speakingUsers[u.id];
                          const isSelf = u.id === currentUser?.id;

                          return (
                            <div
                              key={u.id}
                              onClick={isCurrentVoice ? onOpenVoiceView : undefined}
                              className={`flex items-center justify-between px-2 py-1 rounded-lg text-xs cursor-pointer transition ${
                                isSpeaking 
                                  ? 'bg-tc-green/10 text-tc-green font-semibold' 
                                  : 'text-tc-text hover:bg-tc-card/60'
                              }`}
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center border transition-transform ${
                                  isSpeaking ? 'border-tc-green scale-110' : 'border-transparent'
                                }`}>
                                  <UserAvatar avatar={u.avatar} className="w-5 h-5 rounded-full" textClassName="text-base" />
                                </span>
                                <span className="truncate">
                                  {u.username} {isSelf && '(Sen)'}
                                </span>
                              </div>

                              <div className="flex items-center space-x-1.5 text-tc-muted">
                                {isSpeaking && (
                                  <div className="flex items-end h-3">
                                    <span className="sound-bar" />
                                    <span className="sound-bar" />
                                    <span className="sound-bar" />
                                  </div>
                                )}
                                {u.isScreenSharing && (
                                  <span className="text-[9px] font-bold bg-tc-coral px-1 rounded text-white">
                                    CANLI
                                  </span>
                                )}
                                {u.isMuted && <MicOff className="w-3 h-3 text-tc-coral" />}
                                {u.isDeafened && <Headphones className="w-3 h-3 text-tc-amber" />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Area: Active Voice Status + User Profile Dock */}
      <div>
        {/* Connected Voice Status */}
        {activeVoiceChannel && (
          <div className="bg-tc-sidebar border-t border-tc-border p-2.5 flex items-center justify-between">
            <div 
              onClick={onOpenVoiceView}
              className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition truncate"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-tc-green animate-ping" />
              <div className="truncate">
                <div className="text-xs text-tc-green font-bold flex items-center space-x-1">
                  <span>Ses Bağlandı</span>
                  <span className="text-[10px] text-tc-muted font-normal">(P2P)</span>
                </div>
                <div className="text-[11px] text-tc-muted truncate font-medium">
                  {channels.voice?.find(v => v.id === activeVoiceChannel)?.name}
                </div>
              </div>
            </div>

            <button
              onClick={onLeaveVoiceChannel}
              title="Bağlantıyı Kes"
              className="p-1.5 rounded-lg text-tc-muted hover:text-white hover:bg-tc-coral transition"
            >
              <PhoneOff className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* User Profile Bar */}
        <div className="h-14 bg-tc-sidebar px-2.5 flex items-center justify-between border-t border-tc-border">
          {/* User info */}
          <div 
            onClick={onOpenSettings}
            className="flex items-center space-x-2 p-1 rounded-lg hover:bg-tc-card cursor-pointer transition max-w-[125px]"
          >
            <div className="relative w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0">
              <UserAvatar avatar={currentUser?.avatar} className="w-7 h-7 rounded-full border border-tc-border" textClassName="text-2xl" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-tc-green border-2 border-tc-sidebar" />
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-tc-white leading-tight truncate">
                {currentUser?.username || 'Misafir'}
              </div>
              <div className="text-[10px] text-tc-green font-medium truncate">
                Çevrimiçi
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-0.5 text-tc-muted">
            <button
              onClick={onToggleMute}
              title={currentUser?.isMuted ? 'Mikrofonu Aç' : 'Mikrofonu Kapat'}
              className={`p-1.5 rounded-lg transition ${
                currentUser?.isMuted 
                  ? 'text-tc-coral bg-tc-coral/15 hover:bg-tc-coral/25' 
                  : 'hover:bg-tc-card hover:text-tc-white'
              }`}
            >
              {currentUser?.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              onClick={onToggleDeafen}
              title={currentUser?.isDeafened ? 'Kulaklığı Aç' : 'Kulaklığı Kapat'}
              className={`p-1.5 rounded-lg transition ${
                currentUser?.isDeafened 
                  ? 'text-tc-amber bg-tc-amber/15 hover:bg-tc-amber/25' 
                  : 'hover:bg-tc-card hover:text-tc-white'
              }`}
            >
              <Headphones className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenSettings}
              title="Kullanıcı Ayarları"
              className="p-1.5 rounded-lg hover:bg-tc-card hover:text-tc-white transition"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
