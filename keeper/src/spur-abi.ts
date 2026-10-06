// ABI minimal untuk keeper Spur (human-readable). Dijaga sama dengan contracts/src oleh test/spur-abi.test.ts,
// supaya perubahan tanda tangan fungsi di kontrak yang lupa disalin ke sini menggagalkan tes, bukan transaksi.
import { parseAbi } from "viem";

const QUOTE = "(address vault, address picker, uint64 round, uint256 strikeE18, uint64 expiry, uint256 notional, uint256 premium, uint64 deadline)";
const ROUND = "(uint64 start, uint64 expiry, uint256 strikeE18, uint256 startPriceE18, uint256 notional, uint256 minPremium, address picker, uint256 premium, uint256 settlePriceE18, uint256 payout, uint256 ppsStart, uint256 accStart, uint8 outcome)";

export const spurVaultAbi = parseAbi([
  "function ASSET() view returns (address)",
  "function ROUTER() view returns (address)",
  "function SETTLEMENT() view returns (address)",
  "function AUCTION() view returns (address)",
  "function FILL_WINDOW() view returns (uint32)",
  "function MIN_DURATION() view returns (uint32)",
  "function MAX_DURATION() view returns (uint32)",
  "function paused() view returns (bool)",
  "function active() view returns (bool)",
  "function round() view returns (uint64)",
  `function getRound(uint64 n) view returns (${ROUND})`,
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function rollRound(uint64 expiry)",
  "function closeUnsold()",
  "function settleRound()",
]);
export const harvestAuctionAbi = parseAbi([
  "function isPicker(address) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  `function fill(${QUOTE} q, bytes signature)`,
]);
export const settlementOracleAbi = parseAbi([
  "function MAX_PRINT_DELAY() view returns (uint32)",
  "function settlement(address token, uint64 expiry) view returns ((uint256 priceE18, uint256 roundUpdatedAt, uint80 roundId, uint64 settledAt, uint8 kind, bool exists))",
  "function settle(address token, uint64 expiry, uint80 roundId)",
  "function settleFallback(address token, uint64 expiry, uint80 roundId)",
]);
export const routerFeedAbi = parseAbi(["function feedOf(address token) view returns (address feed, bool checkOraclePause)"]);
export const aggregatorAbi = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/** keccak256("KEEPER_ROLE"), sama dengan contracts/src/libraries/Roles.sol. */
export const KEEPER_ROLE = "0xfc8737ab85eb45125971625a9ebdb75cc78e01d5c1fa80c4c6e5203f47bc4fab" as const;
