// ABI minimal SpurVault untuk indexer (human-readable). Dijaga sama dengan contracts/src/SpurVault.sol oleh test/spur-abi.test.ts,
// jadi perubahan event di kontrak yang lupa disalin ke sini akan menggagalkan tes, bukan diam-diam membuat indexer buta.
import { parseAbi } from "viem";

export const SPUR_EVENT_SIGNATURES = [
  "event Deposited(address indexed account, uint64 indexed forRound, uint256 amount)",
  "event DepositCancelled(address indexed account, uint256 amount)",
  "event WithdrawRequested(address indexed account, uint64 indexed forRound, uint256 shares)",
  "event WithdrawCancelled(address indexed account, uint256 shares)",
  "event RoundStarted(uint64 indexed round, uint64 expiry, uint256 strikeE18, uint256 startPriceE18, uint256 notional, uint256 minPremium, uint256 ppsStart, uint256 totalShares)",
  "event RoundSkipped(uint64 indexed round, uint256 ppsStart)",
  "event RoundSold(uint64 indexed round, address indexed picker, uint256 premium)",
  "event RoundSettled(uint64 indexed round, uint256 settlePriceE18, uint256 payout)",
  "event RoundClosedUnsold(uint64 indexed round)",
  "event PremiumClaimed(address indexed account, uint256 amount)",
] as const;

export const spurVaultAbi = parseAbi([
  ...SPUR_EVENT_SIGNATURES,
  "function ASSET() view returns (address)",
  "function PREMIUM() view returns (address)",
  "function UNDERLYING() view returns (address)", // hanya ada di GraftVault; dipanggil bila kind = graft
  "function sharesOf(address account) view returns (uint256)",
  "function getRound(uint64 n) view returns ((uint64 start, uint64 expiry, uint256 strikeE18, uint256 startPriceE18, uint256 notional, uint256 minPremium, address picker, uint256 premium, uint256 settlePriceE18, uint256 payout, uint256 ppsStart, uint256 accStart, uint8 outcome))",
]);
