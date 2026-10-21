import React from 'react';
import { 
  Gamepad2, 
  Flame, 
  Sparkles, 
  Plus, 
  Compass, 
  Trophy,
  Swords
} from 'lucide-react';

export default function ServerSidebar({ activeServer, onSelectServer }) {
  const servers = [
    { id: 'main', name: 'Ana Oyun Odası', icon: '🎮', color: 'bg-gradient-to-tr from-indigo-500 to-purple-500' },
    { id: 'fps', name: 'FPS & Rekabet', icon: '⚡', color: 'bg-gradient-to-tr from-emerald-500 to-teal-500' },
    { id: 'turnuva', name: 'Turnuvalar', icon: '🏆', color: 'bg-gradient-to-tr from-amber-500 to-orange-500' }
  ];

  return (
    <aside className="w-[72px] bg-tc-sidebar border-r border-tc-border flex flex-col items-center py-3 space-y-2.5 select-none z-20 flex-shrink-0">
      {/* TurkCord Home Pill */}
      <button
        onClick={() => onSelectServer('main')}
        title="TurkCord Ana Sayfa"
        className="relative group flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-tc-primary to-indigo-600 text-white shadow-lg hover:shadow-indigo-500/25 hover:scale-105 active:scale-95 transition-all duration-200"
      >
        <Gamepad2 className="w-6 h-6 transition-transform group-hover:rotate-12 duration-200" />
        
        {/* Active Pill Indicator */}
        <div className={`absolute -left-3 w-1.5 rounded-r-full bg-white transition-all duration-200 ${
          activeServer === 'main' ? 'h-9' : 'h-0 group-hover:h-5'
        }`} />
      </button>

      <div className="w-8 h-[2px] bg-tc-border rounded-full my-1" />

      {/* Server List */}
      <div className="flex-1 space-y-2.5">
        {servers.map((s) => {
          const isActive = activeServer === s.id;
          return (
            <div key={s.id} className="relative group flex items-center justify-center">
              {/* White side pill */}
              <div className={`absolute -left-3 w-1.5 rounded-r-full bg-tc-primary transition-all duration-200 ${
                isActive ? 'h-9' : 'h-0 group-hover:h-5'
              }`} />

              <button
                onClick={() => onSelectServer(s.id)}
                title={s.name}
                className={`flex items-center justify-center w-12 h-12 text-xl transition-all duration-200 hover:scale-105 active:scale-95 ${
                  isActive
                    ? `${s.color} rounded-2xl shadow-md text-white font-bold ring-2 ring-white/20`
                    : 'bg-tc-card hover:bg-tc-cardHover rounded-3xl hover:rounded-2xl border border-tc-border hover:border-tc-borderLight'
                }`}
              >
                <span>{s.icon}</span>
              </button>
            </div>
          );
        })}

        {/* Add Server */}
        <button
          title="Sunucu Ekle"
          className="flex items-center justify-center w-12 h-12 rounded-3xl hover:rounded-2xl bg-tc-card hover:bg-tc-green hover:text-white text-tc-green border border-dashed border-tc-border hover:border-transparent transition-all duration-200 hover:scale-105 active:scale-95 group"
        >
          <Plus className="w-5 h-5 transition-transform group-hover:rotate-90 duration-200" />
        </button>

        {/* Explore */}
        <button
          title="Keşfet"
          className="flex items-center justify-center w-12 h-12 rounded-3xl hover:rounded-2xl bg-tc-card hover:bg-tc-primary hover:text-white text-tc-muted border border-tc-border hover:border-transparent transition-all duration-200 hover:scale-105 active:scale-95"
        >
          <Compass className="w-5 h-5" />
        </button>
      </div>

      {/* Live status dot */}
      <div className="w-2 h-2 rounded-full bg-tc-green animate-pulse" title="Sistem Aktif" />
    </aside>
  );
}
