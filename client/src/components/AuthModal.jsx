import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Mail, Lock, User, ArrowRight, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import TurkCordLogo from './TurkCordLogo';

const AVATARS = ['🎮', '⚡', '🚀', '🔥', '👾', '🎯', '🐱', '🦊', '🐉', '🎧', '🕹️', '🍕'];

export default function AuthModal({ onAuthSuccess }) {
  const [mode, setMode] = useState('login'); // 'login', 'register', 'confirmed_notice'
  const [rememberMe, setRememberMe] = useState(() => {
    try {
      return localStorage.getItem('turkcord_remember_me') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('turkcord_saved_email') || '';
    } catch (e) {
      return '';
    }
  });
  const [password, setPassword] = useState(() => {
    try {
      return localStorage.getItem('turkcord_saved_password') || '';
    } catch (e) {
      return '';
    }
  });
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState('🎮');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successNotice, setSuccessNotice] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (error) {
        if (error.message.toLowerCase().includes('email not confirmed')) {
          setErrorMsg('E-posta adresiniz henüz onaylanmamış! Lütfen gelen kutunuzdaki onay bağlantısına tıklayın.');
        } else if (error.message.toLowerCase().includes('invalid login credentials')) {
          setErrorMsg('E-posta veya şifre hatalı!');
        } else {
          setErrorMsg(error.message);
        }
        setLoading(false);
        return;
      }

      // Fetch profile
      let { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      const userEmail = data.user.email?.toLowerCase();
      const isSuperAdmin = userEmail === 'aerayyoruk@gmail.com';

      // Pasif Hesap Kontrolü: Admin hariç pasife alınmış hesaplar sisteme giriş yapamaz
      if (profile?.is_passive === true && !isSuperAdmin) {
        await supabase.auth.signOut();
        setErrorMsg('🚫 Bu hesap yönetici (aerayyoruk@gmail.com) tarafından pasife alınmıştır. Sisteme giriş yetkiniz durduruldu.');
        setLoading(false);
        return;
      }

      // Ensure user has a unique 10-digit code
      let userCode = profile?.user_code;
      if (!userCode) {
        userCode = Math.floor(1000000000 + Math.random() * 9000000000).toString();
        await supabase.from('profiles').update({ user_code: userCode }).eq('id', data.user.id);
      }

      // Save or clear credentials based on Remember Me preference
      if (rememberMe) {
        try {
          localStorage.setItem('turkcord_remember_me', 'true');
          localStorage.setItem('turkcord_saved_email', email.trim());
          localStorage.setItem('turkcord_saved_password', password);
        } catch (e) {}
      } else {
        try {
          localStorage.setItem('turkcord_remember_me', 'false');
          localStorage.removeItem('turkcord_saved_email');
          localStorage.removeItem('turkcord_saved_password');
        } catch (e) {}
      }

      onAuthSuccess({
        id: data.user.id,
        email: data.user.email,
        isAdmin: isSuperAdmin || profile?.is_admin === true,
        isPassive: Boolean(profile?.is_passive),
        username: profile?.username || data.user.user_metadata?.username || email.split('@')[0],
        avatar: profile?.avatar || data.user.user_metadata?.avatar || '🎮',
        user_code: userCode
      });
    } catch (err) {
      setErrorMsg(err.message || 'Giriş yapılamadı.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessNotice('');

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanUsername) {
      setErrorMsg('Lütfen bir kullanıcı adı belirleyin.');
      return;
    }

    // "admin" kullanıcı adı rezervasyonu: Yalnızca aerayyoruk@gmail.com alabilir
    const isReservedAdminName = ['admin', 'administrator', 'yönetici'].includes(cleanUsername.toLowerCase());
    if (isReservedAdminName && cleanEmail !== 'aerayyoruk@gmail.com') {
      setErrorMsg("🚫 'Admin' kullanıcı adı rezerve edilmiştir ve yalnızca sistem yöneticisine (aerayyoruk@gmail.com) aittir. Lütfen başka bir kullanıcı adı seçin.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: password,
        options: {
          data: {
            username: cleanUsername,
            avatar: avatar
          }
        }
      });

      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      // If Supabase has email confirmation enabled
      if (data?.user && (!data.session || data.user.identities?.length > 0)) {
        setSuccessNotice('📩 Onay e-postası gönderildi! Lütfen gelen kutunuzu (ve spam klasörünü) kontrol edip onay bağlantısına tıklayın. Ardından giriş yapabilirsiniz.');
        setMode('confirmed_notice');
      } else if (data.session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.user.id)
          .single();

        // Save or clear credentials based on Remember Me preference
      if (rememberMe) {
        try {
          localStorage.setItem('turkcord_remember_me', 'true');
          localStorage.setItem('turkcord_saved_email', email.trim());
          localStorage.setItem('turkcord_saved_password', password);
        } catch (e) {}
      } else {
        try {
          localStorage.setItem('turkcord_remember_me', 'false');
          localStorage.removeItem('turkcord_saved_email');
          localStorage.removeItem('turkcord_saved_password');
        } catch (e) {}
      }

      onAuthSuccess({
          id: data.user.id,
          email: data.user.email,
          username: profile?.username || username.trim(),
          avatar: profile?.avatar || avatar,
          user_code: profile?.user_code || Math.floor(1000000000 + Math.random() * 9000000000).toString()
        });
      }
    } catch (err) {
      setErrorMsg(err.message || 'Kayıt olurken bir hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="z-10 flex items-center justify-center p-4 select-none w-full max-w-md">
      <div className="bg-[#161b22]/95 border-2 border-indigo-500/40 rounded-3xl max-w-md w-full p-7 shadow-2xl shadow-indigo-950/40 relative overflow-hidden backdrop-blur-xl">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <TurkCordLogo size={58} className="mx-auto mb-3 drop-shadow-xl" />
          <h2 className="text-2xl font-black text-white">TurkCord</h2>
        </div>

        {/* Success Notice View (After signup) */}
        {mode === 'confirmed_notice' ? (
          <div className="text-center py-4 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-white">Doğrulama E-postası Gönderildi!</h3>
              <p className="text-xs text-[#c9d1d9] mt-2 leading-relaxed bg-[#21262d] p-3.5 rounded-2xl border border-[#30363d]">
                {successNotice}
              </p>
            </div>

            <button
              onClick={() => { setMode('login'); setSuccessNotice(''); }}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition text-sm"
            >
              Giriş Ekranına Dön
            </button>
          </div>
        ) : (
          <>
            {/* Tabs: Giriş Yap | Kayıt Ol */}
            <div className="flex rounded-xl bg-[#0d1117] p-1 border border-[#30363d] mb-5">
              <button
                type="button"
                onClick={() => { setMode('login'); setErrorMsg(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
                  mode === 'login' ? 'bg-indigo-600 text-white shadow' : 'text-[#7d8590] hover:text-white'
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => { setMode('register'); setErrorMsg(''); }}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${
                  mode === 'register' ? 'bg-indigo-600 text-white shadow' : 'text-[#7d8590] hover:text-white'
                }`}
              >
                Kayıt Ol
              </button>
            </div>

            {/* Error Banner */}
            {errorMsg && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-2.5 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3.5">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-[#7d8590] mb-1">
                      Kullanıcı Adı (Oyuncu Tag'i)
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#7d8590] absolute left-3.5 top-3" />
                      <input
                        type="text"
                        required
                        placeholder="Örn: Eray, Ghost..."
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white outline-none transition font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-[#7d8590] mb-1">
                      Avatar Seç
                    </label>
                    <div className="grid grid-cols-6 gap-1.5 bg-[#21262d] p-2.5 rounded-2xl border border-[#30363d]">
                      {AVATARS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          onClick={() => setAvatar(em)}
                          className={`w-9 h-9 rounded-xl text-xl flex items-center justify-center transition ${
                            avatar === em
                              ? 'bg-indigo-600 scale-105 shadow ring-2 ring-indigo-400'
                              : 'hover:bg-[#30363d]'
                          }`}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#7d8590] mb-1">
                  E-posta Adresi
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#7d8590] absolute left-3.5 top-3" />
                  <input
                    type="email"
                    required
                    placeholder="ornek@domain.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white outline-none transition font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#7d8590] mb-1">
                  Şifre
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#7d8590] absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder="En az 6 karakter"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-indigo-500 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white outline-none transition font-medium"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-[#7d8590] hover:text-white transition"
                    title={showPassword ? 'Şifreyi Gizle' : 'Şifreyi Göster'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {mode === 'login' && (
                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center space-x-2 cursor-pointer group select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0 cursor-pointer accent-indigo-600"
                    />
                    <span className="text-xs text-[#c9d1d9] group-hover:text-white transition font-medium">
                      Beni Hatırla (Şifreyi Kaydet)
                    </span>
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center space-x-2 transition shadow-md cursor-pointer mt-4 text-sm active:scale-95"
              >
                <span>{loading ? 'İşleniyor...' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol (Onay Maili Gönder)'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
