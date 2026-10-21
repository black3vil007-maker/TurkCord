import React from 'react';

export default function UserAvatar({ avatar, className = "w-8 h-8 rounded-full", textClassName = "text-xl", fallback = "🎮" }) {
  // Extract string URL if avatar is an object
  let avatarVal = avatar;
  if (avatarVal && typeof avatarVal === 'object') {
    avatarVal = avatarVal.url || avatarVal.avatar_url || avatarVal.avatar || '';
  }

  const isImage = typeof avatarVal === 'string' && (
    avatarVal.startsWith('data:image/') || 
    avatarVal.startsWith('http://') || 
    avatarVal.startsWith('https://')
  );

  if (isImage) {
    return (
      <img
        src={avatarVal}
        alt="Avatar"
        className={`${className} object-cover flex-shrink-0 select-none shadow-sm`}
        onError={(e) => {
          e.target.style.display = 'none';
        }}
      />
    );
  }

  const displayEmoji = (typeof avatarVal === 'string' && avatarVal.trim().length > 0)
    ? avatarVal
    : (typeof fallback === 'string' ? fallback : '🎮');

  return (
    <span className={`${textClassName} flex items-center justify-center select-none flex-shrink-0 leading-none`}>
      {displayEmoji}
    </span>
  );
}
