// Picker menarik hasil opsi yang berakhir in-the-money: claimPickerPayout() hanya bisa dipanggil Picker sendiri (msg.sender).
//   GET /api/cron/picker-claim     Authorization: Bearer <CRON_SECRET>
// Memakai RFQ_PICKER_PRIVATE_KEY (kunci yang sama dengan /api/rfq). Hanya vault di SPUR_VAULT_ADDRESS / GRAFT_VAULT_ADDRESS.
// Mainnet (4663): butuh RFQ_ALLOW_MAINNET=true. Mengirim transaksi hanya bila pickerOwed > 0 dan simulasi lolos.
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { authorized } from "@/lib/api/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const abi = parseAbi(["function pickerOwed(address) view returns (uint256)", "function claimPickerPayout()"]);
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/https?:\/\/\S+/g, "<url>").replace(/0x[0-9a-fA-F]{64}\b/g, "<hex>").replace(/\s+/g, " ").slice(0, 300);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET belum diisi" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const t0 = Date.now();
  try {
    const e = process.env;
    const rpc = e.KEEPER_RPC_URL?.trim() || e.INDEXER_RPC_URL?.trim();
    if (!rpc) return NextResponse.json({ ok: false, error: "KEEPER_RPC_URL / INDEXER_RPC_URL belum diisi" }, { status: 503 });
    const key = e.RFQ_PICKER_PRIVATE_KEY?.trim() ?? "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return NextResponse.json({ ok: false, error: "RFQ_PICKER_PRIVATE_KEY belum valid" }, { status: 503 });
    const chainId = Number(e.RFQ_CHAIN_ID?.trim() || e.KEEPER_CHAIN_ID?.trim() || e.INDEXER_CHAIN_ID?.trim() || 46630);
    if (chainId === 4663 && e.RFQ_ALLOW_MAINNET?.trim() !== "true") return NextResponse.json({ ok: false, error: "mainnet butuh RFQ_ALLOW_MAINNET=true" }, { status: 403 });
    const vaults = ([["spur", e.SPUR_VAULT_ADDRESS], ["graft", e.GRAFT_VAULT_ADDRESS]] as const).filter(([, a]) => a?.trim()) as readonly (readonly ["spur" | "graft", string])[];
    if (!vaults.length) return NextResponse.json({ ok: true, skipped: true, line: "tidak ada SPUR_VAULT_ADDRESS / GRAFT_VAULT_ADDRESS" });

    const transport = http(rpc, { timeout: 15_000, retryCount: 1 });
    const pub = createPublicClient({ transport });
    const actual = await pub.getChainId();
    if (actual !== chainId) return NextResponse.json({ ok: false, error: `RPC chain ${actual} != ${chainId}` }, { status: 500 });
    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({ account, transport });

    const results: { vault: string; owed: string; txHash?: string; note?: string }[] = [];
    let ok = true;
    for (const [name, raw] of vaults) {
      if (!ADDR.test(raw.trim())) { ok = false; results.push({ vault: name, owed: "0", note: "alamat vault tidak valid" }); continue; }
      const address = raw.trim() as `0x${string}`;
      try {
        const owed = await pub.readContract({ address, abi, functionName: "pickerOwed", args: [account.address] });
        if (owed === 0n) { results.push({ vault: name, owed: "0" }); continue; }
        // Transaksi berurutan dan ditunggu receipt-nya: satu kunci, tidak menabrak nonce sendiri.
        const { request } = await pub.simulateContract({ address, abi, functionName: "claimPickerPayout", account });
        const hash = await wallet.writeContract(request);
        const rc = await pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
        if (rc.status !== "success") { ok = false; results.push({ vault: name, owed: owed.toString(), txHash: hash, note: "revert" }); continue; }
        results.push({ vault: name, owed: owed.toString(), txHash: hash });
      } catch (err) { ok = false; results.push({ vault: name, owed: "?", note: clean(err) }); }
    }
    return NextResponse.json({ ok, picker: account.address, results, ms: Date.now() - t0 }, { status: ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: clean(err), ms: Date.now() - t0 }, { status: 500 });
  }
}
