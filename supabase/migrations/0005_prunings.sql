-- Riwayat pruning (rebalancing) per Cordon, untuk tabel "Pruning history" di halaman detail Cordon.
-- Cache dari event onchain seperti tabel lain: hanya service role (indexer/keeper) yang menulis, publik hanya membaca.
-- drift_*_bps = selisih terbesar sebuah saham dari bobot targetnya, sebelum dan sesudah pruning.
create table if not exists prunings (
  id bigint generated always as identity primary key,
  cordon_id uuid not null references cordons(id) on delete cascade,
  ts timestamptz not null,
  drift_before_bps integer not null check (drift_before_bps >= 0),
  drift_after_bps integer not null check (drift_after_bps >= 0),
  trades integer not null check (trades >= 0),
  tx_hash text check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  unique (cordon_id, ts)
);
create index if not exists prunings_recent on prunings (cordon_id, ts desc);
alter table prunings enable row level security;
create policy "public read" on prunings for select to anon, authenticated using (true);
