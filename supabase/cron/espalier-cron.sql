-- Jadwal pg_cron Supabase: indexer (3 Cordon + Spur + Graft), keeper (Spur + Graft + pruning 3 Cordon), dan penyegar feed mock.
-- Jalankan di SQL Editor Supabase, BAGIAN DEMI BAGIAN. Ganti <CRON_SECRET> dan DOMAIN sebelum menjalankan.
-- Bukan migrasi: berisi nilai khusus lingkungan. Belum diuji terhadap project Supabase asli.

-- 1. Ekstensi (atau aktifkan di Dashboard > Database > Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Rahasia disimpan di Vault, tidak ditulis di teks jadwal
select vault.create_secret('<CRON_SECRET>', 'espalier_cron_secret');                 -- sama dengan env CRON_SECRET di Vercel
select vault.create_secret('https://DOMAIN.vercel.app', 'espalier_cron_base_url');   -- tanpa garis miring di akhir

-- 3. Fungsi pemanggil. Schema khusus yang tidak diekspos PostgREST, dan EXECUTE dicabut dari peran publik.
create schema if not exists espalier_cron;
create or replace function espalier_cron.get(p_path text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_base text; v_id bigint;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'espalier_cron_secret';
  select decrypted_secret into v_base   from vault.decrypted_secrets where name = 'espalier_cron_base_url';
  if v_secret is null or v_base is null then raise exception 'secret espalier_cron_* belum dibuat di Vault'; end if;
  select net.http_get(
    url := v_base || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000
  ) into v_id;
  return v_id;
end $$;
revoke all on function espalier_cron.get(text) from public, anon, authenticated;

-- 4. Indexer: tiap aliran tiap menit, dengan jeda berbeda supaya tidak berebut laju RPC gratis.
--    cordon = cMAG7 (CORDON_VAULT_ADDRESS), cordon1 = cCHIP, cordon2 = cVOLT (urutan EXTRA_CORDONS).
--    Hapus baris cordon1/cordon2 bila EXTRA_CORDONS belum berisi Cordon itu (route menjawab "tidak dikonfigurasi", tidak berbahaya).
select cron.schedule('espalier-index-cordon',  '* * * * *', $$select espalier_cron.get('/api/cron/index?stream=cordon')$$);
select cron.schedule('espalier-index-cordon1', '* * * * *', $$select pg_sleep(12); select espalier_cron.get('/api/cron/index?stream=cordon1')$$);
select cron.schedule('espalier-index-cordon2', '* * * * *', $$select pg_sleep(24); select espalier_cron.get('/api/cron/index?stream=cordon2')$$);
select cron.schedule('espalier-index-spur',    '* * * * *', $$select pg_sleep(36); select espalier_cron.get('/api/cron/index?stream=spur')$$);
select cron.schedule('espalier-index-graft',   '* * * * *', $$select pg_sleep(48); select espalier_cron.get('/api/cron/index?stream=graft')$$);

-- 5. Keeper (LIVE bila SPUR_MODE / GRAFT_MODE / KEEPER_MODE = live di Vercel): satu siklus per lane.
--    Satu kunci keeper dipakai semua lane, jadi waktunya disebar supaya transaksi tidak berebut nonce.
select cron.schedule('espalier-keeper-spur',  '*/5 * * * *', $$select espalier_cron.get('/api/cron/keeper?lane=spur')$$);
select cron.schedule('espalier-keeper-graft', '*/5 * * * *', $$select pg_sleep(30); select espalier_cron.get('/api/cron/keeper?lane=graft')$$);
-- Pruning Cordon (bulanan secara logika; polling tiap 10 menit murah). Menit 2/4/6 tidak bentrok dengan Spur dan Graft (kelipatan 5).
-- Hapus baris cordon1/cordon2 bila EXTRA_CORDONS belum berisi Cordon itu.
select cron.schedule('espalier-keeper-cordon',  '2-59/10 * * * *', $$select espalier_cron.get('/api/cron/keeper?lane=cordon')$$);
select cron.schedule('espalier-keeper-cordon1', '4-59/10 * * * *', $$select espalier_cron.get('/api/cron/keeper?lane=cordon1')$$);
select cron.schedule('espalier-keeper-cordon2', '6-59/10 * * * *', $$select espalier_cron.get('/api/cron/keeper?lane=cordon2')$$);

-- 6. Penyegar feed mock testnet: tiap 10 menit (jendela staleness paling pendek 15 menit).
select cron.schedule('espalier-feeds', '*/10 * * * *', $$select espalier_cron.get('/api/cron/feeds')$$);

-- ===== Pemeriksaan =====
-- Jadwal aktif:
--   select jobname, schedule, active from cron.job where jobname like 'espalier-%' order by jobname;
-- Hasil jalan pg_cron terakhir:
--   select j.jobname, d.status, left(d.return_message, 80) as pesan, d.start_time
--   from cron.job_run_details d join cron.job j using (jobid) order by d.start_time desc limit 15;
-- Jawaban dari Vercel (status_code 200 = sukses; isi memuat baris log):
--   select id, status_code, timed_out, left(content::text, 240) as isi, created from net._http_response order by created desc limit 15;
-- Transaksi yang dikirim keeper:
--   select * from keeper_runs order by 1 desc limit 10;

-- ===== Mematikan =====
-- Keeper saja (kembali manual):
--   select cron.unschedule('espalier-keeper-spur'); select cron.unschedule('espalier-keeper-graft');
--   select cron.unschedule('espalier-keeper-cordon'); select cron.unschedule('espalier-keeper-cordon1'); select cron.unschedule('espalier-keeper-cordon2');
-- Semua:
--   select cron.unschedule(jobname) from cron.job where jobname like 'espalier-%';
