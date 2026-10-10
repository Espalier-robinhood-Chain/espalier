-- Jadwal pg_cron Supabase untuk MAINNET (4663): indexer, keeper, klaim payout Picker, dan pemantau.
-- BEDA dari espalier-cron.sql (testnet): TANPA job espalier-feeds (feed mock tidak ada di mainnet) dan ditambah picker-claim + health.
-- Jalankan di SQL Editor project Supabase mainnet, BAGIAN DEMI BAGIAN. Ganti <CRON_SECRET> dan DOMAIN. Belum diuji di Supabase asli.

create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON_SECRET>', 'espalier_cron_secret');
select vault.create_secret('https://DOMAIN', 'espalier_cron_base_url');   -- domain produksi, tanpa garis miring di akhir

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


-- 6. Picker: klaim hasil opsi (claimPickerPayout hanya bisa dipanggil Picker sendiri). Menit 1, tiap 15 menit; mengirim tx hanya bila pickerOwed > 0.
select cron.schedule('espalier-picker-claim', '1-59/15 * * * *', $$select espalier_cron.get('/api/cron/picker-claim')$$);

-- 7. Pemantau: dipanggil juga oleh layanan uptime eksternal (lihat PANDUAN-OTOMATIS-MAINNET.md). Job ini hanya mencatat hasilnya di net._http_response.
select cron.schedule('espalier-health', '*/5 * * * *', $$select espalier_cron.get('/api/cron/health')$$);

-- Pemeriksaan dan mematikan: sama dengan espalier-cron.sql. Pastikan tidak ada job feed lama:
--   select cron.unschedule('espalier-feeds');   -- hanya bila pernah dibuat di project ini
--   select jobname, schedule, active from cron.job where jobname like 'espalier-%' order by jobname;
