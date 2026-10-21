-- ============================================================
-- TurkCord: 10 Haneli Benzersiz Kullanıcı ID (Arkadaş Kodu)
-- Bu SQL kodunu Supabase -> SQL Editor -> New Query açıp RUN diyerek çalıştırın.
-- ============================================================

-- 1. Profiles tablosuna 10 haneli benzersiz 'user_code' kolonu ekle
alter table public.profiles add column if not exists user_code text unique;

-- 2. Mevcut kullanıcılara 10 haneli rastgele benzersiz ID ata
update public.profiles 
set user_code = floor(1000000000 + random() * 9000000000)::text 
where user_code is null;

-- 3. Yeni kayıt olan kullanıcılara otomatik 10 haneli benzersiz ID oluşturan tetikleyici
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, avatar, user_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'Oyuncu_' || substr(new.id::text, 1, 6)),
    coalesce(new.raw_user_meta_data->>'avatar', '🎮'),
    floor(1000000000 + random() * 9000000000)::text
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;
