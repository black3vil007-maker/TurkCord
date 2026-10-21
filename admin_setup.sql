-- ============================================================
-- TurkCord: Admin ve Hesap Durumu (Aktif/Pasif) Veritabanı Ayarı
-- Supabase Panelinde SQL Editor -> New Query açıp çalıştırın.
-- ============================================================

-- 1. Sütunları Ekle
alter table public.profiles add column if not exists is_passive boolean default false;
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists email text;

-- 2. aerayyoruk@gmail.com hesabını Süper Yönetici (Admin) olarak yetkilendir
update public.profiles 
set is_admin = true, is_passive = false 
where id in (select id from auth.users where lower(email) = 'aerayyoruk@gmail.com');

-- 3. Admin'in tüm kullanıcıları pasife/aktife çekebilmesi için RLS Güncellemesi
drop policy if exists "Kullanıcılar kendi profilini güncelleyebilir" on public.profiles;
drop policy if exists "Admin her profili guncelleyebilir" on public.profiles;

create policy "Kullanıcılar ve Admin profilleri güncelleyebilir"
on public.profiles for update
using (
  auth.uid() = id or 
  lower(auth.jwt()->>'email') = 'aerayyoruk@gmail.com' or
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
);

-- Realtime değişiklikleri için publication'a profiles tablosunu dahil et
alter publication supabase_realtime add table public.profiles;
