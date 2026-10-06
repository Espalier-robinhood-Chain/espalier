-- Skema inti Espalier (brief §5.5). Database = cache dari event onchain; bisa dibangun ulang.
-- Penulisan hanya lewat service role (indexer/keeper). Web memakai anon/publishable key (read-only).

create table cordons (
  id uuid primary key default gen_random_uuid(),
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  symbol text not null unique,
  name text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table cordon_assets (
  cordon_id uuid not null references cordons(id) on delete cascade,
  token text not null check (token ~ '^0x[0-9a-f]{40}$'),
  ticker text not null,
  target_weight_bps integer not null check (target_weight_bps between 0 and 10000),
  primary key (cordon_id, token)
);

create table nav_points (
  cordon_id uuid not null references cordons(id) on delete cascade,
  ts timestamptz not null,
  nav_per_share numeric not null,
  total_supply numeric not null,
  tvl_usd numeric not null,
  primary key (cordon_id, ts)
);

create table vaults (
  id uuid primary key default gen_random_uuid(),
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  kind text not null check (kind in ('spur', 'graft')),
  underlying text not null,
  symbol text not null unique,
  is_demo boolean not null default false
);

create table rounds (
  vault_id uuid not null references vaults(id) on delete cascade,
  round_no integer not null,
  strike numeric not null,
  expiry timestamptz not null,
  notional numeric not null,
  premium_usdg numeric,
  picker text check (picker ~ '^0x[0-9a-f]{40}$'),
  settlement_price numeric,
  settled_at timestamptz,
  status text not null check (status in ('open', 'auctioned', 'settled', 'cancelled')),
  primary key (vault_id, round_no)
);

create table positions (
  account text not null check (account ~ '^0x[0-9a-f]{40}$'),
  contract text not null check (contract ~ '^0x[0-9a-f]{40}$'),
  shares numeric not null,
  cost_basis_usd numeric,
  is_demo boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (account, contract)
);

create table harvests (
  account text not null check (account ~ '^0x[0-9a-f]{40}$'),
  vault_id uuid not null,
  round_no integer not null,
  premium_usdg numeric not null,
  claimed_at timestamptz,
  primary key (account, vault_id, round_no),
  foreign key (vault_id, round_no) references rounds(vault_id, round_no) on delete cascade
);

create table keeper_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tx_hash text,
  status text not null check (status in ('running', 'ok', 'failed')),
  error text
);

create index nav_points_recent on nav_points (cordon_id, ts desc);
create index rounds_expiry on rounds (vault_id, expiry desc);
create index harvests_account on harvests (account);

-- RLS: aktif di semua tabel. Tanpa policy insert/update/delete, hanya service role yang bisa menulis.
alter table cordons enable row level security;
alter table cordon_assets enable row level security;
alter table nav_points enable row level security;
alter table vaults enable row level security;
alter table rounds enable row level security;
alter table positions enable row level security;
alter table harvests enable row level security;
alter table keeper_runs enable row level security; -- internal: tanpa policy = tertutup untuk anon/authenticated

create policy "public read" on cordons for select to anon, authenticated using (true);
create policy "public read" on cordon_assets for select to anon, authenticated using (true);
create policy "public read" on nav_points for select to anon, authenticated using (true);
create policy "public read" on vaults for select to anon, authenticated using (true);
create policy "public read" on rounds for select to anon, authenticated using (true);
create policy "public read" on positions for select to anon, authenticated using (true);
create policy "public read" on harvests for select to anon, authenticated using (true);
