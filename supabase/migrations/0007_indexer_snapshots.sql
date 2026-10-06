-- Snapshot indexer Spur (tahap 6). Posisi Spur bukan ERC-20 dan share per round tidak bisa dibaca dari state terbaru, jadi indexer
-- menyimpan ledger hasil replay event. Kursor dan ledger berada di SATU baris supaya tulisnya atomik (tidak mungkin kursor maju
-- sementara ledger tertinggal, atau sebaliknya). key = 'spur:<chainId>:<alamat vault huruf kecil>'.
-- Membangun ulang dari event: hapus baris ini, jalankan ulang indexer dari SPUR_START_BLOCK (tulis ke rounds/harvests/positions berupa upsert).
-- Hanya service role: RLS aktif tanpa policy = tertutup untuk anon/authenticated.
create table if not exists indexer_snapshots (
  key text primary key,
  cursor text not null check (cursor ~ '^\d+$'),
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table indexer_snapshots enable row level security;

