-- ============================================================
-- TurkCord: Veritabanı Performans İndeksleri & Kalıcı Sohbet Tablosu
-- Supabase Panelinde "SQL Editor" -> "New query" açıp tek seferde çalıştırın.
-- ============================================================

-- 1. METİN KANALLARI KALICI SOHBET LOG TABLOSU
create table if not exists public.channel_messages (
  id text primary key,
  channel_id text not null,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_username text not null,
  sender_avatar text default '🎮',
  text text,
  image text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS (Row Level Security) Etkinleştir
alter table public.channel_messages enable row level security;

-- Güvenlik Politikaları (Policies)
drop policy if exists "Mesajlar herkes tarafından okunabilir" on public.channel_messages;
create policy "Mesajlar herkes tarafından okunabilir" 
on public.channel_messages for select using (true);

drop policy if exists "Kullanıcılar mesaj gönderebilir" on public.channel_messages;
create policy "Kullanıcılar mesaj gönderebilir" 
on public.channel_messages for insert 
with check (auth.uid() is not null);

drop policy if exists "Kullanıcılar veya admin mesaj silebilir" on public.channel_messages;
create policy "Kullanıcılar veya admin mesaj silebilir" 
on public.channel_messages for delete 
using (
  auth.uid() = sender_id 
  or (select lower(email) from auth.users where id = auth.uid()) = 'aerayyoruk@gmail.com'
);

-- Realtime (Canlı mesaj yayını) için publication'a ekle
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channel_messages'
  ) then
    alter publication supabase_realtime add table public.channel_messages;
  end if;
end $$;

-- ============================================================
-- 2. VERİTABANI PERFORMANS İNDEKSLERİ (Yüksek Sorgu Hızı)
-- ============================================================

-- A. SOHBET LOGLARI (channel_messages) İNDEKSLERİ
-- Kanal bazında mesajları kronolojik sırayla ultra hızlı çekmek için birleşik B-Tree indeksi
create index if not exists idx_channel_messages_channel_created 
on public.channel_messages (channel_id, created_at asc);

create index if not exists idx_channel_messages_sender 
on public.channel_messages (sender_id);

create index if not exists idx_channel_messages_created_at 
on public.channel_messages (created_at desc);

-- B. KULLANICI PROFİLLERİ (profiles) İNDEKSLERİ
-- 10 Haneli Arkadaş Arama ID'si (user_code) için hızlı arama indeksi
create index if not exists idx_profiles_user_code 
on public.profiles (user_code);

-- Kullanıcı adı aramaları için küçük harf fonksiyonel indeksi
create index if not exists idx_profiles_username_lower 
on public.profiles (lower(username));

create index if not exists idx_profiles_created_at 
on public.profiles (created_at desc);

-- C. ARKADAŞLIKLAR (friendships) İNDEKSLERİ
-- Arkadaş listesi ve istekleri için optimize çift yönlü indeksler
create index if not exists idx_friendships_user_id 
on public.friendships (user_id);

create index if not exists idx_friendships_friend_id 
on public.friendships (friend_id);

create index if not exists idx_friendships_status 
on public.friendships (status);

create index if not exists idx_friendships_user_status 
on public.friendships (user_id, status);

create index if not exists idx_friendships_friend_status 
on public.friendships (friend_id, status);

create index if not exists idx_friendships_pair 
on public.friendships (user_id, friend_id);

-- D. ODA DAVETLERİ (room_invites) İNDEKSLERİ
-- Gelen bekleyen davetleri anında yakalamak için birleşik indeks
create index if not exists idx_room_invites_to_user_status 
on public.room_invites (to_user_id, status);

create index if not exists idx_room_invites_from_user 
on public.room_invites (from_user_id);

create index if not exists idx_room_invites_created_at 
on public.room_invites (created_at desc);

-- E. SES ODALARI (voice_rooms) İNDEKSLERİ
create index if not exists idx_voice_rooms_created_by 
on public.voice_rooms (created_by);

create index if not exists idx_voice_rooms_created_at 
on public.voice_rooms (created_at desc);
