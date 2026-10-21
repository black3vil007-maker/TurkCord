-- ============================================================
-- TurkCord: Kalıcı Ses Odaları Tablosu
-- Bu SQL kodunu Supabase -> SQL Editor -> New Query açıp RUN diyerek çalıştırın.
-- ============================================================

-- 1. Ses Odaları Tablosu (Kayıtlı ve Kalıcı Odalar)
create table if not exists public.voice_rooms (
  id text primary key,
  name text not null,
  limit_count integer default 5,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Etkinleştir
alter table public.voice_rooms enable row level security;

-- Herkes odaları görebilir
create policy "Herkes odaları görebilir" 
on public.voice_rooms for select using (true);

-- Oturum açmış herkes oda oluşturabilir
create policy "Giriş yapanlar oda oluşturabilir" 
on public.voice_rooms for insert with check (auth.uid() is not null);

-- Oda sahibi odasını silebilir
create policy "Oda sahibi silebilir" 
on public.voice_rooms for delete using (auth.uid() = created_by);

-- 2. Varsayılan Başlangıç Odalarını Ekle
insert into public.voice_rooms (id, name, limit_count) values
  ('voice-lobi', 'Lobi', 10),
  ('voice-oyun-1', 'Oyun Odası #1 (Squad)', 5),
  ('voice-oyun-2', 'Oyun Odası #2 (Duo)', 2),
  ('voice-muhabbet', 'Sessiz / Chill', 8)
on conflict (id) do nothing;

-- 3. Gerçek Zamanlı (Realtime) Yayın Etkinleştir
alter publication supabase_realtime add table public.voice_rooms;
