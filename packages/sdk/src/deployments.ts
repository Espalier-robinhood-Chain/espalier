import { getAddress, isAddress, type Address } from "viem";

/** Bentuk `contracts/deployments/<name>.json` yang ditulis `Deploy.s.sol`. */
export interface Deployment {
  name: string;
  chainId: number;
  mocks: boolean;
  deployedAt: number;
  deployer: Address;
  admin: Address;
  timelock: Address;
  sequencerFeed: Address;
  marketSession: Address;
  oracleRouter: Address;
  settlementOracle: Address;
  cordonVault: Address;
  /** Opsional: hanya ada bila `spur`/`graft` aktif di konfigurasi deploy. */
  spurVault?: Address;
  graftVault?: Address;
  harvestAuction?: Address;
  tokens: Address[];
  feeds: Address[];
}

const ADDR_FIELDS = ["deployer", "admin", "timelock", "sequencerFeed", "marketSession", "oracleRouter", "settlementOracle", "cordonVault"] as const;

/** Validasi JSON deployment. Melempar Error berpesan jelas; hasilnya alamat ber-checksum. */
export function parseDeployment(raw: unknown): Deployment {
  if (typeof raw !== "object" || raw === null) throw new Error("deployment: bukan objek");
  const o = raw as Record<string, unknown>;
  const str = (k: string) => { if (typeof o[k] !== "string") throw new Error(`deployment.${k}: harus string`); return o[k] as string; };
  const num = (k: string) => { if (typeof o[k] !== "number" || !Number.isInteger(o[k])) throw new Error(`deployment.${k}: harus bilangan bulat`); return o[k] as number; };
  const addr = (k: string, v: unknown): Address => { if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new Error(`deployment.${k}: alamat tidak valid`); return getAddress(v); };
  if (typeof o.mocks !== "boolean") throw new Error("deployment.mocks: harus boolean");
  const out: Record<string, unknown> = { name: str("name"), chainId: num("chainId"), mocks: o.mocks, deployedAt: num("deployedAt") };
  for (const k of ADDR_FIELDS) out[k] = addr(k, o[k]);
  for (const k of ["tokens", "feeds"] as const) {
    const arr = o[k];
    if (!Array.isArray(arr)) throw new Error(`deployment.${k}: harus array`);
    out[k] = arr.map((v, i) => addr(`${k}[${i}]`, v));
  }
  for (const k of ["spurVault", "graftVault", "harvestAuction"] as const) if (o[k] !== undefined) out[k] = addr(k, o[k]);
  const d = out as unknown as Deployment;
  if (d.tokens.length !== d.feeds.length) throw new Error("deployment: tokens dan feeds beda panjang");
  if (d.cordonVault === "0x0000000000000000000000000000000000000000") throw new Error("deployment.cordonVault: alamat nol");
  return d;
}
