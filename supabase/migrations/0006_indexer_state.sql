-- Kursor indexer (tahap 3). Satu baris per vault: key = 'cordon:<chainId>:<alamat huruf kecil>', value = blok berikutnya yang akan dipindai.
-- Hanya service role yang membaca/menulis: RLS aktif tanpa policy = tertutup untuk anon/authenticated.
-- Membangun ulang database dari event: hapus baris kursor (dan isi positions/nav_points bila perlu), lalu jalankan ulang indexer.
create table if not exists indexer_state (
  key text primary key,
  value text not null check (value ~ '^\d+$'),
  updated_at timestamptz not null default now()
);
alter table indexer_state enable row level security;
