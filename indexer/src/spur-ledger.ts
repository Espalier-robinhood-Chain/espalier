// Buku besar SpurVault yang murni (tanpa viem/Supabase), dibangun dari event berurutan.
//
// Kenapa event-sourcing, bukan "baca saldo absolut" seperti Cordon: posisi Spur BUKAN ERC-20 dan setoran diubah jadi share
// secara malas saat `rollRound`, jadi pertanyaan "berapa share akun X selama round n" tidak bisa dijawab dari state terbaru
// (butuh node arsip). Dengan mereplikasi aturan kontrak dari event, jawabannya deterministik dan bisa dibangun ulang.
// Keamanan: setiap round, hasil ledger dibandingkan dengan kontrak (`sharesOf`, total share, jumlah klaim). Selisih di luar
// toleransi pembulatan = galat keras, kursor tidak maju (jangan menebak).
//
// Aturan kontrak yang direplikasi (SpurVault.sol):
//  * deposit -> `pendingDeposit`; menjadi share saat roll berikutnya: floor(amount * 1e18 / ppsStart) PER AKUN.
//  * requestWithdraw -> `pendingWithdraw`; share dikurangi saat roll berikutnya.
//  * share yang masuk saat roll n berhak atas premium round n; yang keluar saat roll n tidak berhak atas round n.
//  * premium round n (RoundSold) dibagi: delta = floor(premium * 2^128 / totalSharesRound), hak akun = floor(delta * shares / 2^128).
//  * claimPremium mengambil SEMUA hak yang menumpuk, jadi satu event PremiumClaimed menutup semua round yang belum diklaim.

export const WAD = 10n ** 18n;
export const MAG = 2n ** 128n;

export interface Owed { round: number; amount: bigint }
export interface LedgerAccount { shares: bigint; pendingDeposit: bigint; pendingWithdraw: bigint; owed: Owed[] }
export interface Ledger {
  accounts: Map<string, LedgerAccount>;
  /** Nomor round terakhir yang di-roll (RoundStarted atau RoundSkipped). 0 = belum ada. */
  lastRound: number;
  /** Round yang opsinya masih berjalan (RoundStarted tanpa RoundSettled/RoundClosedUnsold). */
  active: { round: number; totalShares: bigint } | null;
}

type Pos = { block: bigint; logIndex: number };
export type SpurEvent = Pos & (
  | { type: "Deposited"; account: string; amount: bigint }
  | { type: "DepositCancelled"; account: string; amount: bigint }
  | { type: "WithdrawRequested"; account: string; shares: bigint }
  | { type: "WithdrawCancelled"; account: string; shares: bigint }
  | { type: "RoundStarted"; round: number; ppsStart: bigint; totalShares: bigint }
  | { type: "RoundSkipped"; round: number; ppsStart: bigint }
  | { type: "RoundSold"; round: number; picker: string; premium: bigint }
  | { type: "RoundSettled"; round: number }
  | { type: "RoundClosedUnsold"; round: number }
  | { type: "PremiumClaimed"; account: string; amount: bigint }
);

export interface HarvestOut { account: string; round: number; amount: bigint; claimedAt: Date | null }
export interface Effects {
  /** Round yang statusnya mungkin berubah: nilainya dibaca absolut dari kontrak oleh pemanggil. */
  touchedRounds: Set<number>;
  /** Waktu blok RoundSettled, untuk kolom `settled_at`. */
  settledAt: Map<number, Date>;
  /** Keadaan akhir tiap (akun, round) yang berubah di batch ini. Kunci `${account}|${round}`. */
  harvests: Map<string, HarvestOut>;
  /** Akun yang shares-nya mungkin berubah (untuk `positions`). */
  changedAccounts: Set<string>;
}

export const newLedger = (): Ledger => ({ accounts: new Map(), lastRound: 0, active: null });

const acct = (l: Ledger, a: string): LedgerAccount => {
  let x = l.accounts.get(a);
  if (!x) { x = { shares: 0n, pendingDeposit: 0n, pendingWithdraw: 0n, owed: [] }; l.accounts.set(a, x); }
  return x;
};
const fail = (msg: string): never => { throw new Error(`ledger tidak konsisten: ${msg}`); };

/** Terapkan pemrosesan antrean saat roll. Mengembalikan jumlah akun yang dikonversi (untuk toleransi pembulatan). */
function roll(l: Ledger, round: number, pps: bigint, fx: Effects): number {
  if (round !== l.lastRound + 1) fail(`round ${round} datang setelah ${l.lastRound} (log terlewat? START_BLOCK terlalu besar?)`);
  if (l.active) fail(`round ${round} dimulai saat round ${l.active.round} masih aktif`);
  if (pps <= 0n) fail(`ppsStart round ${round} nol`);
  let converted = 0;
  for (const [addr, a] of l.accounts) {
    if (a.pendingDeposit === 0n && a.pendingWithdraw === 0n) continue;
    converted++;
    a.shares += (a.pendingDeposit * WAD) / pps;
    if (a.pendingWithdraw > a.shares) fail(`penarikan ${a.pendingWithdraw} melebihi share ${a.shares} untuk ${addr}`);
    a.shares -= a.pendingWithdraw;
    a.pendingDeposit = 0n;
    a.pendingWithdraw = 0n;
    fx.changedAccounts.add(addr);
  }
  l.lastRound = round;
  return converted;
}

export function sumShares(l: Ledger): bigint {
  let t = 0n;
  for (const a of l.accounts.values()) t += a.shares;
  return t;
}

/** Selisih maksimum yang wajar antara jumlah share per-akun (ledger) dan total agregat kontrak: tiap roll menambah <= 1 wei per akun. */
export const shareTolerance = (l: Ledger): bigint => BigInt(l.accounts.size + 1) * BigInt(l.lastRound + 1);

/**
 * Terapkan event (sudah terurut blok, logIndex) ke ledger. MENGUBAH ledger. `tsOf` harus bisa menjawab untuk blok
 * RoundSettled dan PremiumClaimed (pemanggil mengambilnya lebih dulu).
 */
export function applyEvents(l: Ledger, events: SpurEvent[], tsOf: (block: bigint) => Date): Effects {
  const fx: Effects = { touchedRounds: new Set(), settledAt: new Map(), harvests: new Map(), changedAccounts: new Set() };
  for (let i = 1; i < events.length; i++) {
    const p = events[i - 1]!, c = events[i]!;
    if (c.block < p.block || (c.block === p.block && c.logIndex <= p.logIndex)) fail("event tidak terurut");
  }
  for (const e of events) {
    switch (e.type) {
      case "Deposited": acct(l, e.account).pendingDeposit += e.amount; break;
      case "DepositCancelled": {
        const a = acct(l, e.account);
        if (e.amount > a.pendingDeposit) fail(`batal setoran ${e.amount} > antre ${a.pendingDeposit} untuk ${e.account}`);
        a.pendingDeposit -= e.amount; break;
      }
      case "WithdrawRequested": acct(l, e.account).pendingWithdraw += e.shares; break;
      case "WithdrawCancelled": {
        const a = acct(l, e.account);
        if (e.shares > a.pendingWithdraw) fail(`batal penarikan ${e.shares} > antre ${a.pendingWithdraw} untuk ${e.account}`);
        a.pendingWithdraw -= e.shares; break;
      }
      case "RoundStarted": {
        roll(l, e.round, e.ppsStart, fx);
        const diff = sumShares(l) - e.totalShares;
        if ((diff < 0n ? -diff : diff) > shareTolerance(l)) fail(`total share round ${e.round}: ledger ${sumShares(l)} vs kontrak ${e.totalShares}`);
        l.active = { round: e.round, totalShares: e.totalShares };
        fx.touchedRounds.add(e.round);
        break;
      }
      case "RoundSkipped": roll(l, e.round, e.ppsStart, fx); fx.touchedRounds.add(e.round); break; // tanpa opsi: tidak ada baris `rounds`
      case "RoundSold": {
        if (!l.active || l.active.round !== e.round) fail(`RoundSold ${e.round} tanpa round aktif yang cocok`);
        const total = l.active!.totalShares;
        if (total === 0n) fail(`RoundSold ${e.round} dengan total share nol`);
        const delta = (e.premium * MAG) / total; // sama dengan `accPremium += mulDiv(premium, MAG, totalShares)`
        for (const [addr, a] of l.accounts) {
          if (a.shares === 0n) continue;
          const amount = (delta * a.shares) / MAG;
          if (amount === 0n) continue;
          a.owed.push({ round: e.round, amount });
          fx.harvests.set(`${addr}|${e.round}`, { account: addr, round: e.round, amount, claimedAt: null });
        }
        fx.touchedRounds.add(e.round);
        break;
      }
      case "RoundSettled":
      case "RoundClosedUnsold": {
        if (!l.active || l.active.round !== e.round) fail(`${e.type} ${e.round} tanpa round aktif yang cocok`);
        l.active = null;
        fx.touchedRounds.add(e.round);
        if (e.type === "RoundSettled") fx.settledAt.set(e.round, tsOf(e.block));
        break;
      }
      case "PremiumClaimed": {
        const a = acct(l, e.account);
        let sum = 0n;
        const at = tsOf(e.block);
        for (const o of a.owed) {
          sum += o.amount;
          fx.harvests.set(`${e.account}|${o.round}`, { account: e.account, round: o.round, amount: o.amount, claimedAt: at });
        }
        const diff = sum - e.amount;
        if ((diff < 0n ? -diff : diff) > BigInt(l.lastRound + 1)) fail(`klaim premium ${e.account}: ledger ${sum} vs event ${e.amount}`);
        a.owed = [];
        break;
      }
    }
  }
  return fx;
}

// ---- Serialisasi (snapshot di DB; bigint sebagai string) ----
export interface LedgerJson {
  v: 1; lastRound: number;
  active: { round: number; totalShares: string } | null;
  accounts: Record<string, { s: string; d: string; w: string; o: Array<[number, string]> }>;
}
export function ledgerToJson(l: Ledger): LedgerJson {
  const accounts: LedgerJson["accounts"] = {};
  for (const [k, a] of l.accounts) {
    // Akun kosong total tidak disimpan: menjaga snapshot kecil.
    if (a.shares === 0n && a.pendingDeposit === 0n && a.pendingWithdraw === 0n && a.owed.length === 0) continue;
    accounts[k] = { s: a.shares.toString(), d: a.pendingDeposit.toString(), w: a.pendingWithdraw.toString(), o: a.owed.map((x) => [x.round, x.amount.toString()]) };
  }
  return { v: 1, lastRound: l.lastRound, active: l.active ? { round: l.active.round, totalShares: l.active.totalShares.toString() } : null, accounts };
}
export function ledgerFromJson(j: unknown): Ledger {
  const o = j as LedgerJson | null;
  if (!o || o.v !== 1 || typeof o.lastRound !== "number" || typeof o.accounts !== "object") throw new Error("snapshot ledger rusak atau versi tidak dikenal");
  const l = newLedger();
  l.lastRound = o.lastRound;
  l.active = o.active ? { round: o.active.round, totalShares: BigInt(o.active.totalShares) } : null;
  for (const [k, a] of Object.entries(o.accounts)) l.accounts.set(k, { shares: BigInt(a.s), pendingDeposit: BigInt(a.d), pendingWithdraw: BigInt(a.w), owed: a.o.map(([round, amount]) => ({ round, amount: BigInt(amount) })) });
  return l;
}
