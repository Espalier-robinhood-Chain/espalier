-- Supabase Realtime (Fase 1 item 20): halaman detail berlangganan perubahan tabel lewat postgres_changes.
-- Supabase hanya mengirim event untuk tabel yang ada di publication `supabase_realtime`; tanpa ini langganan
-- berhasil tersambung tetapi tidak pernah menerima event.
--   nav_points  -> halaman Cordon (titik NAV baru)
--   rounds      -> halaman vault (round baru, dilelang, settle; riwayat Harvest dibangun dari tabel ini)
-- RLS tetap berlaku: Realtime hanya mengirim baris yang boleh dibaca role pelanggan. Policy "public read"
-- (0001) sudah mengizinkan anon, jadi tidak ada policy baru. Event tanpa filter DELETE tidak dipakai.
-- Idempotent dan aman di database tanpa publication itu (mis. Postgres biasa untuk pengujian).
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['nav_points', 'rounds'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
