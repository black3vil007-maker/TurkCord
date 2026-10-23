import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { 
  Hash, 
  Send, 
  Smile, 
  PlusCircle, 
  Users, 
  Volume2,
  Sparkles,
  Flame,
  Heart,
  Laugh,
  ThumbsUp
} from 'lucide-react';

export default function ChatArea({
  channel,
  messages,
  onSendMessage,
  onToggleMemberList,
  showMemberList,
  activeVoiceChannel,
  onOpenVoiceView
}) {
  const [inputText, setInputText] = useState('');
  const [reactions, setReactions] = useState({}); // { [msgId]: { [emoji]: count } }
  const [showEmojiBar, setShowEmojiBar] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const prevMsgLengthRef = useRef(messages?.length || 0);
  const initialScrollDoneRef = useRef(false);

  // Kanal acildiginda veya degistiginde titreme olmaksizin aninda en alta konumlan
  useLayoutEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      initialScrollDoneRef.current = true;
    }
    const rafId = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
        initialScrollDoneRef.current = true;
      }
    });
    prevMsgLengthRef.current = messages?.length || 0;
    return () => cancelAnimationFrame(rafId);
  }, [channel?.id]);

  // Mesajlar yuklendiginde veya yeni mesaj geldiginde
  useLayoutEffect(() => {
    if (!initialScrollDoneRef.current && (messages?.length || 0) > 0) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
      initialScrollDoneRef.current = true;
      prevMsgLengthRef.current = messages.length;
      return;
    }

    if (initialScrollDoneRef.current && (messages?.length || 0) > prevMsgLengthRef.current) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
    prevMsgLengthRef.current = messages?.length || 0;
  }, [messages?.length]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleAddReaction = (msgId, emoji) => {
    setReactions(prev => {
      const msgReactions = prev[msgId] || {};
      const currentCount = msgReactions[emoji] || 0;
      return {
        ...prev,
        [msgId]: {
          ...msgReactions,
          [emoji]: currentCount + 1
        }
      };
    });
  };

  const quickEmojis = ['🔥', '🎮', '😂', '❤️', '🚀', '👑'];

  return (
    <main className="flex-1 bg-tc-bg flex flex-col h-full overflow-hidden">
      {/* Channel Header */}
      <header className="h-14 px-4 border-b border-tc-border flex items-center justify-between flex-shrink-0 bg-tc-bg/95 backdrop-blur z-10">
        <div className="flex items-center space-x-2 truncate">
          <Hash className="w-5 h-5 text-tc-muted" />
          <span className="font-bold text-tc-white text-base">{channel?.name}</span>
          <div className="h-4 w-[1px] bg-tc-border mx-2" />
          <span className="text-xs text-tc-muted hidden sm:inline truncate max-w-md">
            {channel?.description || 'Arkadaşlarınla sohbet et ve oyun taktikleri paylaş'}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {activeVoiceChannel && (
            <button
              onClick={onOpenVoiceView}
              className="px-3 py-1.5 bg-tc-green/15 hover:bg-tc-green/25 text-tc-green border border-tc-green/30 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition active:scale-95"
            >
              <Volume2 className="w-3.5 h-3.5 animate-bounce" />
              <span>Ses Odasını Aç</span>
            </button>
          )}

          <button
            onClick={onToggleMemberList}
            title="Üyeleri Göster / Gizle"
            className={`p-2 rounded-xl border transition ${
              showMemberList 
                ? 'bg-tc-card border-tc-primary text-tc-primary' 
                : 'bg-tc-panel border-tc-border text-tc-muted hover:text-tc-text hover:bg-tc-card'
            }`}
          >
            <Users className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Welcome Message in Channel */}
        <div className="my-6 p-4 rounded-2xl bg-tc-card/50 border border-tc-border max-w-lg">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-tc-primary to-purple-600 flex items-center justify-center text-white mb-3 shadow-md">
            <Hash className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-tc-white">#{channel?.name} kanalına hoş geldin!</h2>
          <p className="text-xs text-tc-muted mt-1 leading-relaxed">
            Burası kanalın başlangıcı. Mesaj yazabilir, emoji tepkisi verebilir veya sol menüden ses odasına geçebilirsin!
          </p>
        </div>

        {/* Message Items */}
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const isSameSender = prevMsg && prevMsg.sender.id === msg.sender.id && (
            new Date(msg.timestamp) - new Date(prevMsg.timestamp) < 5 * 60 * 1000
          );

          const timeFormatted = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
          });

          const msgReactions = reactions[msg.id] || {};

          return (
            <div
              key={msg.id || index}
              className={`relative flex items-start space-x-3 -mx-2 px-3 py-1.5 rounded-xl hover:bg-tc-card/40 transition-colors group ${
                !isSameSender ? 'mt-3' : 'mt-0.5'
              }`}
            >
              {/* Quick Floating Reaction Bar on Hover */}
              <div className="absolute right-4 -top-3 hidden group-hover:flex items-center space-x-1 bg-tc-card border border-tc-border px-2 py-1 rounded-full shadow-lg z-10 transition">
                {['🔥', '❤️', '😂', '👍'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleAddReaction(msg.id, emoji)}
                    className="hover:scale-125 transition-transform text-xs p-0.5"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {!isSameSender ? (
                <div className="w-10 h-10 rounded-2xl bg-tc-card border border-tc-border flex items-center justify-center text-2xl flex-shrink-0 select-none shadow-sm">
                  {msg.sender?.avatar || '🎮'}
                </div>
              ) : (
                <div className="w-10 text-[10px] text-tc-muted opacity-0 group-hover:opacity-100 flex-shrink-0 text-right select-none pr-1">
                  {timeFormatted}
                </div>
              )}

              <div className="flex-1 overflow-hidden">
                {!isSameSender && (
                  <div className="flex items-baseline space-x-2">
                    <span className="font-bold text-tc-white text-sm hover:underline cursor-pointer">
                      {msg.sender?.username}
                    </span>
                    <span className="text-[11px] text-tc-muted">
                      {timeFormatted}
                    </span>
                  </div>
                )}

                <div className="text-sm text-tc-text leading-relaxed break-words whitespace-pre-wrap select-text font-normal mt-0.5">
                  {msg.text}
                </div>

                {/* Reactions badge under message */}
                {Object.keys(msgReactions).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {Object.entries(msgReactions).map(([emoji, count]) => (
                      <button
                        key={emoji}
                        onClick={() => handleAddReaction(msg.id, emoji)}
                        className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-tc-primary/10 border border-tc-primary/30 text-xs font-medium hover:bg-tc-primary/20 transition"
                      >
                        <span>{emoji}</span>
                        <span className="text-[11px] font-bold text-tc-primary">{count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <div className="p-4 pt-1">
        {/* Quick Emojis strip */}
        {showEmojiBar && (
          <div className="flex items-center space-x-2 mb-2 p-2 bg-tc-card border border-tc-border rounded-xl">
            {quickEmojis.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setInputText((prev) => prev + ` ${em} `)}
                className="text-lg hover:scale-125 transition-transform"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative bg-tc-panel border border-tc-border focus-within:border-tc-primary rounded-2xl flex items-center px-4 py-3 shadow-md transition-all">
          <button
            type="button"
            title="Dosya Paylaş"
            className="text-tc-muted hover:text-tc-white mr-3 transition"
          >
            <PlusCircle className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`#${channel?.name || 'genel'} kanalına yaz...`}
            className="flex-1 bg-transparent text-sm text-tc-white placeholder-tc-muted outline-none font-medium"
          />

          <div className="flex items-center space-x-2 text-tc-muted ml-2">
            <button
              type="button"
              onClick={() => setShowEmojiBar(!showEmojiBar)}
              title="Emojiler"
              className={`p-1 rounded-lg transition ${showEmojiBar ? 'text-tc-primary bg-tc-primary/10' : 'hover:text-tc-white'}`}
            >
              <Smile className="w-5 h-5" />
            </button>

            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-2 rounded-xl bg-tc-primary hover:bg-tc-primaryHover text-white disabled:opacity-30 disabled:cursor-not-allowed transition shadow-sm active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
