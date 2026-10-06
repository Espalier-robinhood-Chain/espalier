-- Fase 1 item 22: login wallet (Supabase Auth Web3, EIP-4361) + preferensi privasi The Wall + RLS.
--
-- Aturan yang diterapkan:
--   * Wall bawaannya PRIVAT (brief). Pemilik membukanya sendiri lewat tabel wall_preferences.
--   * `positions` dan `harvests` tidak lagi terbaca publik: hanya pemilik (login dengan wallet itu)
--     atau siapa saja bila pemilik memilih publik.
--   * Penulisan data posisi/harvest tetap hanya lewat service role (indexer). Web hanya menulis wall_preferences,
--     hanya untuk wallet miliknya sendiri.
--
-- Data demo: akun demo tidak punya pemilik yang bisa login, jadi seed demo (Fase 1 item 3) HARUS menambahkan
-- baris wall_preferences (account, is_private = false) untuk tiap akun demo lewat service role.

-- 1. Alamat wallet milik user yang sedang login ----------------------------------------------------------------
-- Dibaca dari auth.identities (baris ini dibuat Supabase Auth dari pesan yang tanda tangannya sudah terverifikasi
-- dan TIDAK bisa diubah user), bukan dari user_metadata (user bisa mengubahnya lewat updateUser).
-- Hanya identitas provider 'web3', dan provider_id harus persis berbentuk [awalan:]0x<40 hex>. Tanpa jangkar
-- itu, identitas email yang provider_id-nya memuat sepotong alamat orang lain bisa menyamar. Tidak cocok = tidak
-- ada alamat (gagal tertutup). Cek bentuk provider_id sungguhan di README ("Verifikasi login pertama").
create or replace function public.wallet_addresses()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct t.addr), '{}'::text[])
  from (
    select lower((regexp_match(i.provider_id, '^(?:[A-Za-z0-9_-]+:)*(0x[0-9a-fA-F]{40})$'))[1]) as addr
    from auth.identities as i
    where i.user_id = auth.uid()
      and i.provider = 'web3'
  ) as t
  where t.addr is not null
$$;

revoke all on function public.wallet_addresses() from public;
-- anon ikut diberi hak eksekusi karena kebijakan RLS memanggilnya atas nama peminta; untuk anon hasilnya selalu {}.
grant execute on function public.wallet_addresses() to anon, authenticated, service_role;

-- 2. Preferensi privasi ------------------------------------------------------------------------------------------
create table wall_preferences (
  account text primary key check (account ~ '^0x[0-9a-f]{40}$'),
  is_private boolean not null default true,
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger wall_preferences_touch
  before update on wall_preferences
  for each row execute function public.touch_updated_at();

alter table wall_preferences enable row level security;

-- Baris publik terlihat siapa saja; baris privat hanya oleh pemiliknya. Dengan begitu penonton lain tidak bisa
-- membedakan "alamat ini privat" dari "alamat ini tidak pernah memakai Espalier".
create policy "read public or own" on wall_preferences
  for select to anon, authenticated
  using (not is_private or account in (select unnest(public.wallet_addresses())));

create policy "owner inserts" on wall_preferences
  for insert to authenticated
  with check (account in (select unnest(public.wallet_addresses())));

create policy "owner updates" on wall_preferences
  for update to authenticated
  using (account in (select unnest(public.wallet_addresses())))
  with check (account in (select unnest(public.wallet_addresses())));

-- Tanpa policy delete: untuk "reset", pemilik cukup mengubah is_private menjadi true.

-- Hak tabel dibuat eksplisit (project Supabase baru tidak selalu memberi hak otomatis, dan yang lama memberi terlalu banyak).
revoke all on wall_preferences from anon, authenticated;
grant select on wall_preferences to anon, authenticated;
grant insert (account, is_private) on wall_preferences to authenticated;
-- `account` ikut diizinkan di update: upsert PostgREST (ON CONFLICT DO UPDATE) menyetel semua kolom isi, termasuk
-- kunci konflik. Kebijakan "owner updates" (with check) tetap menolak memindahkan baris ke alamat yang bukan miliknya.
grant update (account, is_private) on wall_preferences to authenticated;
grant all on wall_preferences to service_role;

-- 3. positions dan harvests: tidak lagi publik ------------------------------------------------------------------
drop policy "public read" on positions;
drop policy "public read" on harvests;

create policy "read public or own wall" on positions
  for select to anon, authenticated
  using (
    account in (select unnest(public.wallet_addresses()))
    or exists (
      select 1 from public.wall_preferences as w
      where w.account = positions.account and not w.is_private
    )
  );

create policy "read public or own wall" on harvests
  for select to anon, authenticated
  using (
    account in (select unnest(public.wallet_addresses()))
    or exists (
      select 1 from public.wall_preferences as w
      where w.account = harvests.account and not w.is_private
    )
  );
