# 🇹🇷 TurkCord - Sıfır Gecikmeli WebRTC Ses & Oyun Platformu

TurkCord; arkadaşlarınızla oyun oynarken arka planda minimum kaynak tüketen, P2P WebRTC altyapısıyla sıfır gecikmeli sesli/görüntülü iletişim kurmanızı sağlayan ve Supabase ile güvenli kimlik doğrulama & arkadaşlık sistemi içeren modern bir web uygulamasıdır.

## 🚀 Özellikler

- **Supabase Auth & E-posta Doğrulama:** Kayıt olurken onay e-postası gider, onaylandıktan sonra güvenle giriş yapılır.
- **Kadro & Arkadaşlık Sistemi:** Kullanıcı adına göre arama yapıp istek gönderme, kabul/reddet ve canlı çevrimiçi/ses durumu.
- **Odaya Canlı Davet Et:** Ses odasındayken tek tıkla arkadaşınıza davet gönderin, ekranda anlık açılan bildirimle tek tıkla odaya katılsın.
- **WebRTC P2P Mesh Ses:** Doğrudan tarayıcılar arası aktarım (~15-30ms ultra düşük gecikme).
- **Ses Algılama (VAD) & Canlı Ekolayzır:** Konuşurken yeşil halka ve dalga animasyonu.
- **Ekran & Oyun Yayını:** Ses odasında 60 FPS ekran/oyun paylaşımı.

---

## 🛠️ Kurulum & Çalıştırma

### 1. Supabase Yapılandırması
1. [supabase.com](https://supabase.com) adresinde yeni bir proje açın.
2. Sol menüden **SQL Editor** -> **New Query** seçin.
3. Proje kökündeki [`supabase_setup.sql`](./supabase_setup.sql) dosyasının içeriğini yapıştırıp **Run** butonuna basın.
4. **Project Settings -> API** bölümünden `Project URL` ve `anon public key` değerlerini alın.
5. `client/.env` dosyası oluşturup bilgilerinizi girin:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

### 2. Uygulamayı Başlatma
Tek tıkla başlatmak için kök dizindeki **`start.bat`** dosyasını çalıştırın veya:
```bash
# Backend (Port 4000)
cd server && npm install && npm start

# Frontend (Port 3000)
cd client && npm install && npm run dev
```

Tarayıcınızda: `http://localhost:3000`

---

## 🌐 GitHub & Canlı Yayına Alma (Deploy)

1. **GitHub Reposu:**
   ```bash
   git init
   git add .
   git commit -m "feat: TurkCord with Supabase auth and friends system"
   git branch -M main
   git remote add origin https://github.com/KULLANICI_ADINIZ/turkcord.git
   git push -u origin main
   ```
2. **Frontend Yayını:** [Vercel](https://vercel.com) üzerinden `client` klasörünü seçip `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` ortam değişkenlerini ekleyerek ücretsiz yayınlayabilirsiniz.
3. **Backend Yayını:** [Render](https://render.com) veya [Railway](https://railway.app) üzerinde `server` klasörünü Node.js web servisi olarak barındırabilirsiniz.
