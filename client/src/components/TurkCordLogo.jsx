import React from 'react';

export default function TurkCordLogo({ size = 36, className = '' }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={`flex-shrink-0 ${className}`}
    >
      <defs>
        {/* Ana Arka Plan Gradyanı */}
        <linearGradient id="tc-shield-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="50%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>

        {/* Türk Kırmızısı -> Neon Mor/İndigo Siber Gradyan */}
        <linearGradient id="tc-neon-crimson" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff0055" />
          <stop offset="60%" stopColor="#e11d48" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>

        {/* Elektrik Camgöbeği (Cyan) Enerji Gradyanı */}
        <linearGradient id="tc-cyan-energy" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>

        {/* Işıma Filtresi */}
        <filter id="tc-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#ff0055" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Dış Siber Kalkan (Gaming Shield) */}
      <path 
        d="M50 4 L88 18 L88 56 Q88 84 50 96 Q12 84 12 56 L12 18 Z" 
        fill="url(#tc-shield-grad)" 
        stroke="url(#tc-neon-crimson)" 
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* İç İnce Siber Hat */}
      <path 
        d="M50 11 L81 23 L81 54 Q81 77 50 88 Q19 77 19 54 L19 23 Z" 
        fill="none" 
        stroke="#38bdf8" 
        strokeWidth="1.2" 
        strokeOpacity="0.35" 
      />

      {/* Geometrik Türk Hilali & Gaming Kanatları */}
      <g filter="url(#tc-glow)">
        {/* Sol Keskin Hilal Kanadı */}
        <path 
          d="M50 20 C34 20 22 34 22 51 C22 68 34 81 50 81 C38 74 32 63 32 51 C32 38 38 27 50 20 Z" 
          fill="url(#tc-neon-crimson)" 
        />

        {/* Sağ Gaming Kanat / Pençe Detayı */}
        <path 
          d="M57 26 L74 38 L68 50 L77 58 L63 68 L55 60 L61 48 Z" 
          fill="url(#tc-neon-crimson)" 
          fillOpacity="0.9"
        />

        {/* Merkez Enerji Yıldızı / Elmas Gaming Çekirdeği */}
        <polygon 
          points="52,38 56,48 66,51 56,54 52,64 48,54 38,51 48,48" 
          fill="url(#tc-cyan-energy)" 
        />
        
        {/* Merkez Işık Noktası */}
        <circle cx="52" cy="51" r="2.5" fill="#ffffff" />
      </g>
    </svg>
  );
}
