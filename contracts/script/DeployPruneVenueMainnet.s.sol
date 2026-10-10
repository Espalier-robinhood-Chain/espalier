// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {UniswapV3PruneVenue} from "../src/venues/UniswapV3PruneVenue.sol";

/// Deploy UniswapV3PruneVenue ke MAINNET (4663). Dijalankan lewat prune-venue-mainnet.sh (yang mengisi env dan menolak chain lain).
/// Env: UNISWAP_ROUTER (SwapRouter02), USDG, VENUE_OWNER (Safe), VENUE_TOKENS (alamat, koma), VENUE_FEES (fee, koma, urutan sama).
contract DeployPruneVenueMainnet is Script {
    function run() external {
        require(block.chainid == 4663, "bukan chain 4663");
        require(vm.envOr("CONFIRM_MAINNET_DEPLOY", false), "set CONFIRM_MAINNET_DEPLOY=true");
        address router = vm.envAddress("UNISWAP_ROUTER");
        address usdg = vm.envAddress("USDG");
        address venueOwner = vm.envAddress("VENUE_OWNER");
        address[] memory tokens = vm.envAddress("VENUE_TOKENS", ",");
        uint256[] memory feeRaw = vm.envUint("VENUE_FEES", ",");
        require(tokens.length == feeRaw.length && tokens.length > 0, "tokens/fees tidak sama panjang");
        uint24[] memory fees = new uint24[](feeRaw.length);
        for (uint256 i; i < feeRaw.length; ++i) {
            fees[i] = uint24(feeRaw[i]);
        }
        vm.startBroadcast();
        UniswapV3PruneVenue v = new UniswapV3PruneVenue(router, usdg, venueOwner, tokens, fees);
        vm.stopBroadcast();
        console2.log("UniswapV3PruneVenue:", address(v));
        console2.log("owner:", venueOwner);
    }
}
