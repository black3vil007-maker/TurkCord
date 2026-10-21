-- ============================================================
-- TurkCord: Supabase Veritabanı ve Güvenlik Yapılandırması
-- Bu kodları Supabase Panelinde "SQL Editor" -> "New query" açıp çalıştırın.
-- ============================================================

-- 1. PROFİLLER TABLOSU
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar text default '🎮',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS (Row Level Security) Etkinleştir
alter table public.profiles enable row level security;

-- Herkes profilleri okuyabilir (arkadaş arama ve listeleme için)
create policy "Profiller herkes tarafından görüntülenebilir" 
on public.profiles for select using (true);

-- Kullanıcı sadece kendi profilini güncelleyebilir
create policy "Kullanıcılar kendi profilini güncelleyebilir" 
on public.profiles for update using (auth.uid() = id);

-- 2. OTOMATİK PROFİL OLUŞTURUCU TETİKLEYİCİ (TRIGGER)
-- Kullanıcı kayıt olduğunda profili otomatik oluşturur
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Oyuncu_' || substr(new.id::text, 1, 6)),
    coalesce(new.raw_user_meta_data->>'avatar', '🎮')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger'ı auth.users üzerine bağla
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3. ARKADAŞLIKLAR TABLOSU
create table if not exists public.friendships (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  friend_id uuid references public.profiles(id) on delete cascade not null,
  status text check (status in ('pending', 'accepted', 'rejected')) not null default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (user_id, friend_id)
);

alter table public.friendships enable row level security;

create policy "Kullanıcılar kendi arkadaşlıklarını görebilir" 
on public.friendships for select 
using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "Kullanıcılar arkadaşlık isteği gönderebilir" 
on public.friendships for insert 
with check (auth.uid() = user_id);

create policy "Kullanıcılar gelen isteği güncelleyebilir" 
on public.friendships for update 
using (auth.uid() = friend_id or auth.uid() = user_id);

create policy "Kullanıcılar arkadaşlığı silebilir" 
on public.friendships for delete 
using (auth.uid() = user_id or auth.uid() = friend_id);

-- 4. ODA DAVETLERİ TABLOSU
create table if not exists public.room_invites (
  id uuid default gen_random_uuid() primary key,
  from_user_id uuid references public.profiles(id) on delete cascade not null,
  to_user_id uuid references public.profiles(id) on delete cascade not null,
  room_id text not null,
  room_name text not null,
  status text check (status in ('pending', 'accepted', 'declined')) default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.room_invites enable row level security;

create policy "Kullanıcılar davetlerini görebilir" 
on public.room_invites for select 
using (auth.uid() = to_user_id or auth.uid() = from_user_id);

create policy "Kullanıcılar davet gönderebilir" 
on public.room_invites for insert 
with check (auth.uid() = from_user_id);

create policy "Kullanıcılar daveti güncelleyebilir" 
on public.room_invites for update 
using (auth.uid() = to_user_id);

-- 5. REALTIME (CANLI BİLDİRİM) AKTİFLEŞTİRME
-- room_invites ve friendships tablolarına realtime yayın ekle
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.room_invites;
