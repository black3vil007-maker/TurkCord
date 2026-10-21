-- ============================================================
-- TurkCord: Ses Odaları Şifre, Düzenleme ve Silme İzinleri
-- Supabase Dashboard -> "SQL Editor" -> "New query" açıp çalıştırın.
-- ============================================================

-- 1. Şifre Sütunu Ekle (Varsa atlar)
alter table public.voice_rooms add column if not exists password text;

-- 2. Odaları Güncelleme (Düzenleme) İzni
drop policy if exists "Kullanıcılar odaları güncelleyebilir" on public.voice_rooms;
create policy "Kullanıcılar odaları güncelleyebilir" 
on public.voice_rooms for update 
using (true);

-- 3. Odaları Silme İzni
drop policy if exists "Oda sahibi silebilir" on public.voice_rooms;
drop policy if exists "Kullanıcılar odaları silebilir" on public.voice_rooms;
create policy "Kullanıcılar odaları silebilir" 
on public.voice_rooms for delete 
using (true);
