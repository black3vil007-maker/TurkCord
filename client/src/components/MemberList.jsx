import React from 'react';
import { Volume2, MicOff, Headphones } from 'lucide-react';

export default function MemberList({ users, currentUser, channels }) {
  const onlineUsers = users || [];

  return (
    <aside className="w-60 bg-tc-panel border-l border-tc-border p-3 overflow-y-auto select-none hidden lg:block">
      {/* Header */}
      <div className="text-[11px] font-bold text-tc-muted uppercase tracking-wider mb-2 px-2">
        Çevrimiçi — {onlineUsers.length}
      </div>

      <div className="space-y-0.5">
        {onlineUsers.map((u) => {
          const isSelf = u.id === currentUser?.id;
          const currentVoiceChannelName = u.currentVoiceRoom
            ? channels.voice?.find(v => v.id === u.currentVoiceRoom)?.name
            : null;

          return (
            <div
              key={u.id}
              className="flex items-center space-x-2.5 px-2 py-1.5 rounded-xl hover:bg-tc-card cursor-pointer transition group"
            >
              {/* Avatar with Online Dot */}
              <div className="relative flex-shrink-0">
                <span className="text-2xl">{u.avatar || '🎮'}</span>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-tc-green border-2 border-tc-panel" />
              </div>

              {/* Username & Status */}
              <div className="truncate flex-1">
                <div className="text-xs font-bold text-tc-text group-hover:text-white truncate transition">
                  {u.username} {isSelf && '(Sen)'}
                </div>

                {currentVoiceChannelName ? (
                  <div className="text-[11px] text-tc-green flex items-center space-x-1 truncate font-medium">
                    <Volume2 className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{currentVoiceChannelName}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-tc-muted truncate">
                    Lobide takılıyor 🕹️
                  </div>
                )}
              </div>

              {/* Status icons */}
              <div className="flex items-center space-x-1 text-tc-muted">
                {u.isMuted && <MicOff className="w-3.5 h-3.5 text-tc-coral" />}
                {u.isDeafened && <Headphones className="w-3.5 h-3.5 text-tc-amber" />}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
