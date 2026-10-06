-- Harga acuan di awal round: dibutuhkan untuk menghitung realized APY (premium / (notional × spot_start)).
alter table rounds add column spot_start numeric;
