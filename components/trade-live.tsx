'use client';
// Panel mint/redeem sungguhan (tahap 2 di Alur Kerja): approve -> simulate -> kirim -> tunggu receipt, lewat wagmi + @espalier/sdk.
// Hanya dirender bila tradeLive(symbol) (lihat trade-panels.tsx), jadi WagmiProvider pasti ada.
import {
  cordonVaultAbi,
  checkReadiness,
  decodeCordonError,
  fullMask,
  maxWithSlippage,
  minWithSlippage,
  quoteMint,
  quoteRedeem,
  quoteRedeemToUsdg,
  readUsdgVenue,
  readVaultInfo,
  type VaultInfo,
} from '@espalier/sdk';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
  useWriteContract,
} from 'wagmi';
import {
  BatchFailed,
  BatchUnavailable,
  sendAtomicBatch,
  walletSupportsBatch,
  type Call,
  type Rpc,
} from '@/lib/web3/batch';
import { robinhoodMainnet, robinhoodTestnet } from '@/lib/web3/chains';
import type { VaultTarget } from '@/lib/web3/env';
import {
  cordonErrorMessage,
  formatAmount,
  isUserRejection,
  parseAmount,
  pendingApprovals,
  SLIPPAGE_OPTIONS,
  USDG_PRICE_UNAVAILABLE,
  type SlippageLabel,
} from '@/lib/web3/trade';
import { Button, Panel } from './ui';
import { AmountField, Radio, Segmented, note } from './trade-fields';

type Comp = { token: Address; symbol: string; decimals: number };
type Quote = {
  amounts: bigint[];
  limits: bigint[];
  allowances: bigint[];
  balances: bigint[];
  usdgOut?: bigint;
  minUsdg?: bigint;
};
type UsdgToken = { symbol: string; decimals: number };
type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'ok'; text: string; hash?: Hash }
  | { kind: 'error'; text: string };

const explorerOf = (chainId: number) =>
  [robinhoodMainnet, robinhoodTestnet].find((c) => c?.id === chainId)
    ?.blockExplorers?.default.url;

/** Pesan galat untuk pengguna. Di jalur USDG, galat yang tidak dikenal hampir selalu harga live yang tidak tersedia (error router tidak ada di ABI vault). */
function failureText(
  e: unknown,
  usdgMode: boolean,
  symbols: readonly string[],
): string {
  const d = decodeCordonError(e);
  if (usdgMode && d.name === 'Unknown') return USDG_PRICE_UNAVAILABLE;
  return cordonErrorMessage(d, symbols);
}

export function LiveMintRedeemPanel({
  symbol,
  target,
  marketOpen,
  nextOpen,
}: {
  symbol: string;
  target: VaultTarget;
  marketOpen: boolean;
  nextOpen?: string;
}) {
  // `target` = vault untuk `symbol` (cMAG7 atau cCHIP), dipilih oleh MintRedeemPanel lewat cordonTargetFor().
  const { address: account, chainId: walletChain, isConnected } = useAccount();
  const client = usePublicClient({ chainId: target.chainId }) as unknown as
    | PublicClient
    | undefined;
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { data: walletClient } = useWalletClient({ chainId: target.chainId });

  const [mode, setMode] = useState<'mint' | 'redeem'>('mint');
  const [amount, setAmount] = useState('');
  const [slip, setSlip] = useState<SlippageLabel>('0.5%');
  const [to, setTo] = useState<'in-kind' | 'usdg'>('in-kind');
  // null = vault ini belum punya venue USDG (atau kontrak lama): "To USDG" tetap mati.
  const [usdgToken, setUsdgToken] = useState<UsdgToken | null>(null);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [comps, setComps] = useState<Comp[]>([]);
  // Hasil baca disimpan bersama kuncinya (akun / input kuotasi); bila kunci berubah, hasil lama otomatis tidak dipakai (tanpa setState sinkron di effect).
  const [shareRead, setShareRead] = useState<{
    account: string;
    balance: bigint | null;
  } | null>(null);
  const [quoteRead, setQuoteRead] = useState<{
    key: string;
    quote: Quote;
  } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [batchOk, setBatchOk] = useState<boolean | null>(null); // null = sedang dicek; true = wallet bisa batch atomic
  const [nonce, setNonce] = useState(0); // naik setelah transaksi: baca ulang saldo dan allowance
  const rid = useId();

  const vault = target.address;
  const shares = useMemo(
    () => (info ? parseAmount(amount, info.decimals) : null),
    [amount, info],
  );
  const onTargetChain = walletChain === target.chainId;
  const symbols = comps.map((c) => c.symbol);
  const shareBalance =
    shareRead && account && shareRead.account === account
      ? shareRead.balance
      : null;
  const useUsdg = mode === 'redeem' && to === 'usdg' && usdgToken !== null;
  const quoteKey = `${account ?? ''}|${vault}|${mode}|${useUsdg ? 'usdg' : 'kind'}|${slip}|${shares === null ? 'x' : shares.toString()}|${nonce}`;
  const quote =
    quoteRead && quoteRead.key === quoteKey ? quoteRead.quote : null;

  // Apakah wallet + chain ini mendukung batch atomic (EIP-5792)? Dipakai untuk label tombol dan indikator.
  useEffect(() => {
    if (!walletClient || !account || !onTargetChain) return;
    let off = false;
    walletSupportsBatch(
      walletClient.request as unknown as Rpc,
      account,
      target.chainId,
    ).then((ok) => {
      if (!off) setBatchOk(ok);
      console.debug('[mint] EIP-5792 batch support:', ok, {
        chainId: target.chainId,
        account,
      });
    });
    return () => {
      off = true;
    };
  }, [walletClient, account, onTargetChain, target.chainId]);

  // Metadata vault dan token komponen: sekali per klien.
  useEffect(() => {
    if (!client) return;
    let off = false;
    (async () => {
      try {
        const v = await readVaultInfo(client, vault);
        const metas = await Promise.all(
          v.components.map(async (token) => {
            const [sym, dec] = await Promise.all([
              client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: 'symbol',
              }),
              client.readContract({
                address: token,
                abi: erc20Abi,
                functionName: 'decimals',
              }),
            ]);
            return { token, symbol: sym, decimals: dec };
          }),
        );
        if (!off) {
          setInfo(v);
          setComps(metas);
        }
      } catch {
        if (!off)
          setStatus({
            kind: 'error',
            text: 'Could not read the vault on-chain. Check the vault address and network.',
          });
      }
    })();
    return () => {
      off = true;
    };
  }, [client, vault]);

  // Venue USDG (opsional): aktif bila ADMIN sudah memasang venue lewat setExecutionVenue.
  useEffect(() => {
    if (!client) return;
    let off = false;
    (async () => {
      const v = await readUsdgVenue(client, vault);
      if (!v) {
        if (!off) setUsdgToken(null);
        return;
      }
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({
            address: v.usdg,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          client.readContract({
            address: v.usdg,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
        ]);
        if (!off) setUsdgToken({ symbol, decimals });
      } catch {
        if (!off) setUsdgToken(null);
      }
    })();
    return () => {
      off = true;
    };
  }, [client, vault]);

  // Saldo share pemilik (untuk redeem).
  useEffect(() => {
    if (!client || !account) return;
    let off = false;
    client
      .readContract({
        address: vault,
        abi: cordonVaultAbi,
        functionName: 'balanceOf',
        args: [account],
      })
      .then((b) => {
        if (!off) setShareRead({ account, balance: b });
      })
      .catch(() => {
        if (!off) setShareRead({ account, balance: null });
      });
    return () => {
      off = true;
    };
  }, [client, account, vault, nonce]);

  // Kuotasi (ditunda 400 ms setelah mengetik). Batas slippage dan allowance dihitung dari kuotasi yang sama.
  useEffect(() => {
    if (!client || !info || shares === null) return;
    let off = false;
    const t = setTimeout(async () => {
      try {
        const bps = SLIPPAGE_OPTIONS[slip];
        if (useUsdg) {
          // Redeem ke USDG: batas bawah dihitung dari total USDG, bukan per komponen.
          const q = await quoteRedeemToUsdg(client, vault, shares);
          const amounts = [...q.amounts];
          const minUsdg = minWithSlippage([q.usdgOut], bps)[0]!;
          if (!off)
            setQuoteRead({
              key: quoteKey,
              quote: {
                amounts,
                limits: amounts.map(() => 0n),
                allowances: amounts.map(() => 0n),
                balances: amounts.map(() => 0n),
                usdgOut: q.usdgOut,
                minUsdg,
              },
            });
          return;
        }
        const amounts = [
          ...(mode === 'mint'
            ? (await quoteMint(client, vault, shares)).amounts
            : (await quoteRedeem(client, vault, shares)).amounts),
        ];
        const limits =
          mode === 'mint'
            ? maxWithSlippage(amounts, bps)
            : minWithSlippage(amounts, bps);
        let allowances = amounts.map(() => 0n);
        let balances = amounts.map(() => 0n);
        if (mode === 'mint' && account) {
          const r = await checkReadiness(
            client,
            vault,
            account,
            info.components,
            limits,
          );
          allowances = r.map((x) => x.allowance);
          balances = r.map((x) => x.balance);
        }
        if (!off)
          setQuoteRead({
            key: quoteKey,
            quote: { amounts, limits, allowances, balances },
          });
      } catch (e) {
        if (!off)
          setStatus({ kind: 'error', text: failureText(e, useUsdg, symbols) });
      }
    }, 400);
    return () => {
      off = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- symbols hanya dipakai untuk teks error
  }, [
    client,
    info,
    shares,
    mode,
    slip,
    account,
    vault,
    nonce,
    quoteKey,
    useUsdg,
  ]);

  const needsMarket = mode === 'mint' || useUsdg;
  const blocked = needsMarket && !marketOpen;
  const approvals =
    quote && mode === 'mint'
      ? pendingApprovals(quote.allowances, quote.limits)
      : [];
  const lacking =
    quote && mode === 'mint'
      ? quote.amounts.findIndex((a, i) => (quote.balances[i] ?? 0n) < a)
      : -1;
  const overBalance =
    mode === 'redeem' &&
    shares !== null &&
    shareBalance !== null &&
    shares > shareBalance;
  const busy = status.kind === 'busy';

  const send = useCallback(
    async (
      label: string,
      fn: () => Promise<Hash>,
      done: string,
      usdgMode = false,
    ): Promise<boolean> => {
      if (!client) return false;
      setStatus({ kind: 'busy', text: `${label}: confirm in your wallet…` });
      try {
        const hash = await fn();
        setStatus({
          kind: 'busy',
          text: `${label}: waiting for confirmation…`,
        });
        const rc = await client.waitForTransactionReceipt({ hash });
        if (rc.status !== 'success') {
          setStatus({ kind: 'error', text: `${label} reverted on-chain.` });
          return false;
        }
        setStatus({ kind: 'ok', text: done, hash });
        setNonce((n) => n + 1);
        return true;
      } catch (e) {
        setStatus(
          isUserRejection(e)
            ? { kind: 'idle' }
            : { kind: 'error', text: failureText(e, usdgMode, symbols) },
        );
        return false;
      }
    },
    [client, symbols],
  );

  const act = async () => {
    if (!client || !account || !info || shares === null || !quote) return;
    if (!onTargetChain) {
      try {
        await switchChainAsync({ chainId: target.chainId });
      } catch {
        setStatus({
          kind: 'error',
          text: 'Switch your wallet to the right network to continue.',
        });
      }
      return;
    }
    if (mode === 'mint') {
      // Jalur 1 (EIP-5792): bila wallet mendukung batch atomic, semua approve + mint = SATU konfirmasi.
      if (approvals.length > 0 && walletClient) {
        const request = walletClient.request as unknown as Rpc;
        if (await walletSupportsBatch(request, account, target.chainId)) {
          const calls: Call[] = [
            ...approvals.map(
              (i): Call => ({
                to: comps[i]!.token,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'approve',
                  args: [vault, quote.limits[i]!],
                }),
              }),
            ),
            {
              to: vault,
              data: encodeFunctionData({
                abi: cordonVaultAbi,
                functionName: 'mint',
                args: [shares, account, quote.limits],
              }),
            },
          ];
          setStatus({
            kind: 'busy',
            text: `Approve ${approvals.length} token${approvals.length > 1 ? 's' : ''} + Mint: confirm once in your wallet…`,
          });
          try {
            const hash = await sendAtomicBatch(
              request,
              account,
              target.chainId,
              calls,
            );
            setStatus({
              kind: 'ok',
              text: `Minted ${amount} ${symbol}.`,
              hash,
            });
            setNonce((n) => n + 1);
            return;
          } catch (e) {
            if (isUserRejection(e)) {
              setStatus({ kind: 'idle' });
              return;
            }
            if (e instanceof BatchFailed) {
              // Atomic: bila gagal, tidak ada approve yang tertinggal. Jangan ulangi lewat jalur berurutan.
              setStatus({
                kind: 'error',
                text:
                  e.reason === 'timeout'
                    ? 'Still waiting for the wallet to confirm. Check your wallet activity before trying again.'
                    : 'The batch failed and nothing was applied. Refresh the quote and try again, or raise slippage.',
              });
              setNonce((n) => n + 1);
              return;
            }
            if (!(e instanceof BatchUnavailable)) {
              setStatus({
                kind: 'error',
                text: failureText(e, false, symbols),
              });
              return;
            }
            console.debug(
              '[mint] batch ditolak wallet, fallback ke berurutan:',
              e.cause,
            );
            // BatchUnavailable: belum ada yang terkirim, lanjut ke jalur 2.
          }
        }
      }
      // Jalur 2 (fallback): satu klik: approve semua token yang masih kurang (berurutan), lalu langsung mint.
      // Bila salah satu ditolak/gagal, berhenti; klik lagi melanjutkan dari sisa approve.
      for (let n = 0; n < approvals.length; n++) {
        const i = approvals[n]!;
        const c = comps[i]!;
        // Hanya sebesar batas setoran (bukan tak terbatas): paling aman bila vault bermasalah.
        const ok = await send(
          `Approve ${c.symbol} (${n + 1}/${approvals.length})`,
          () =>
            writeContractAsync({
              address: c.token,
              abi: erc20Abi,
              functionName: 'approve',
              args: [vault, quote.limits[i]!],
              chainId: target.chainId,
            }),
          `${c.symbol} approved.`,
        );
        if (!ok) return;
      }
      await send(
        'Mint',
        async () => {
          await client.simulateContract({
            account,
            address: vault,
            abi: cordonVaultAbi,
            functionName: 'mint',
            args: [shares, account, quote.limits],
          });
          return writeContractAsync({
            address: vault,
            abi: cordonVaultAbi,
            functionName: 'mint',
            args: [shares, account, quote.limits],
            chainId: target.chainId,
          });
        },
        `Minted ${amount} ${symbol}.`,
      );
      return;
    }
    if (useUsdg) {
      const minUsdg = quote.minUsdg ?? 0n;
      await send(
        'Redeem to USDG',
        async () => {
          await client.simulateContract({
            account,
            address: vault,
            abi: cordonVaultAbi,
            functionName: 'redeemToUsdg',
            args: [shares, account, minUsdg],
          });
          return writeContractAsync({
            address: vault,
            abi: cordonVaultAbi,
            functionName: 'redeemToUsdg',
            args: [shares, account, minUsdg],
            chainId: target.chainId,
          });
        },
        `Redeemed ${amount} ${symbol} to ${usdgToken?.symbol ?? 'USDG'}.`,
        true,
      );
      return;
    }
    const mask = fullMask(info.components.length);
    await send(
      'Redeem',
      async () => {
        await client.simulateContract({
          account,
          address: vault,
          abi: cordonVaultAbi,
          functionName: 'redeem',
          args: [shares, account, mask, quote.limits],
        });
        return writeContractAsync({
          address: vault,
          abi: cordonVaultAbi,
          functionName: 'redeem',
          args: [shares, account, mask, quote.limits],
          chainId: target.chainId,
        });
      },
      `Redeemed ${amount} ${symbol} in-kind.`,
    );
  };

  let cta = mode === 'mint' ? 'Mint' : 'Redeem';
  if (!isConnected) cta = 'Connect wallet first';
  else if (!onTargetChain) cta = 'Switch network';
  else if (mode === 'mint' && approvals[0] !== undefined)
    cta =
      batchOk === true
        ? 'Approve & Mint (1 confirmation)'
        : `Approve ${approvals.length} token${approvals.length > 1 ? 's' : ''} & Mint`;
  if (busy && mode === 'mint') cta = 'Processing…'; // jangan ikut berubah saat allowance dibaca ulang di tengah proses
  const disabled =
    busy ||
    !isConnected ||
    !info ||
    (onTargetChain &&
      (blocked || shares === null || !quote || lacking >= 0 || overBalance));
  const explorer = explorerOf(target.chainId);

  return (
    <Panel title={`${mode === 'mint' ? 'Mint' : 'Redeem'} ${symbol}`}>
      <div className="space-y-4">
        <Segmented
          label="Mint or redeem"
          value={mode}
          options={['mint', 'redeem']}
          onChange={(m) => {
            setMode(m);
            setStatus({ kind: 'idle' });
          }}
        />
        <AmountField
          label={mode === 'mint' ? 'You receive' : 'You redeem'}
          unit={symbol}
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setStatus({ kind: 'idle' });
          }}
        />
        {mode === 'redeem' && (
          <p
            className={`${note} -mt-2 flex items-center justify-between gap-3`}
            aria-live="polite"
          >
            <span>
              Available to redeem:{' '}
              <span className="font-mono text-ink">
                {!isConnected
                  ? 'connect wallet'
                  : shareBalance === null
                    ? '…'
                    : `${formatAmount(shareBalance, info?.decimals ?? 18, info?.decimals ?? 18)} ${symbol}`}
              </span>
            </span>
            <button
              type="button"
              disabled={!shareBalance || !info}
              onClick={() => {
                if (shareBalance && info) {
                  setAmount(
                    formatAmount(shareBalance, info.decimals, info.decimals),
                  );
                  setStatus({ kind: 'idle' });
                }
              }}
              className="rounded-full px-2.5 py-1 text-[.82rem] font-medium text-leaf underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-leaf disabled:opacity-40 disabled:no-underline"
            >
              Max
            </button>
          </p>
        )}
        {mode === 'redeem' && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">Redeem to</legend>
            <Radio
              name={`${rid}-to`}
              value="in-kind"
              checked={!useUsdg}
              onChange={() => {
                setTo('in-kind');
                setStatus({ kind: 'idle' });
              }}
              title="In-kind"
              hint="Receive every component pro-rata. Always available."
            />
            <Radio
              name={`${rid}-to`}
              value="usdg"
              checked={useUsdg}
              disabled={usdgToken === null}
              onChange={() => {
                setTo('usdg');
                setStatus({ kind: 'idle' });
              }}
              title="To USDG"
              hint={
                usdgToken
                  ? 'Sell the basket for USDG at live prices. Only while the market is open.'
                  : 'Not enabled for this cordon yet. The vault only pays out in-kind.'
              }
            />
          </fieldset>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className={note}>Slippage</span>
          <Segmented
            label="Slippage"
            value={slip}
            options={Object.keys(SLIPPAGE_OPTIONS) as SlippageLabel[]}
            onChange={setSlip}
          />
        </div>
        {shares !== null && info && (
          <div
            className="rounded-xl border border-wire px-3.5 py-3 text-[.88rem]"
            aria-live="polite"
          >
            <p className="mb-1 text-bark">
              {mode === 'mint'
                ? 'You pay (max, incl. fee):'
                : 'You receive (min, after fee):'}
            </p>
            {!quote ? (
              <p className="text-bark">Getting quote…</p>
            ) : useUsdg && usdgToken ? (
              <ul className="space-y-0.5 font-mono">
                <li className="flex justify-between gap-3">
                  <span>{usdgToken.symbol}</span>
                  <span>
                    ≈ {formatAmount(quote.usdgOut ?? 0n, usdgToken.decimals)}
                    <span className="text-bark">
                      {' '}
                      (≥ {formatAmount(quote.minUsdg ?? 0n, usdgToken.decimals)}
                      )
                    </span>
                  </span>
                </li>
              </ul>
            ) : (
              <ul className="space-y-0.5 font-mono">
                {comps.map((c, i) => (
                  <li key={c.token} className="flex justify-between gap-3">
                    <span>{c.symbol}</span>
                    <span>
                      ≈ {formatAmount(quote.amounts[i] ?? 0n, c.decimals)}
                      <span className="text-bark">
                        {' '}
                        ({mode === 'mint' ? '≤' : '≥'}{' '}
                        {formatAmount(quote.limits[i] ?? 0n, c.decimals)})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {lacking >= 0 && (
          <p role="status" className="text-[.88rem] text-blight">
            Not enough {comps[lacking]?.symbol ?? 'token'} in your wallet for
            this amount.
          </p>
        )}
        {overBalance && (
          <p role="status" className="text-[.88rem] text-blight">
            You hold {formatAmount(shareBalance!, info?.decimals ?? 18)}{' '}
            {symbol}.
          </p>
        )}
        {blocked && (
          <p
            role="status"
            className="rounded-xl border border-dashed border-wire px-3.5 py-3 text-[.88rem] text-blight"
          >
            Market closed: {mode === 'mint' ? 'minting' : 'redeeming to USDG'}{' '}
            needs live prices.{nextOpen && ` Opens ${nextOpen}.`} In-kind redeem
            stays available.
          </p>
        )}
        <Button disabled={disabled} onClick={act} className="w-full">
          {cta}
        </Button>
        {mode === 'mint' &&
          isConnected &&
          onTargetChain &&
          approvals.length > 0 &&
          batchOk !== null && (
            <p className={note}>
              {batchOk
                ? 'Your wallet supports batching: one confirmation for all approvals + mint.'
                : `Your wallet doesn't support batching on this network: expect ${approvals.length + 1} confirmations (${approvals.length} approvals + mint).`}
            </p>
          )}
        {status.kind !== 'idle' && (
          <p
            role="status"
            className={
              status.kind === 'error' ? 'text-[.88rem] text-blight' : note
            }
          >
            {status.text}
            {status.kind === 'ok' && status.hash && explorer && (
              <>
                {' '}
                <a
                  className="underline"
                  href={`${explorer}/tx/${status.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </Panel>
  );
}
