// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Roles
/// @notice Pengenal peran bersama (Fase 2 item 5). ADMIN = `DEFAULT_ADMIN_ROLE` bawaan OpenZeppelin.
/// @dev ADMIN: dipegang `TimelockController` (multisig sebagai proposer/executor, jeda 48 jam), mengubah parameter,
///      memberi dan mencabut peran, dan satu-satunya yang boleh membuka kembali (unpause) aset.
///      GUARDIAN: hanya boleh menjeda aset (`pauseAsset`). Tidak bisa memindahkan dana, mengubah parameter,
///      membuka jeda, atau memberi peran.
///      KEEPER: kunci panas untuk pekerjaan rutin dengan wewenang sempit (saat ini hanya MENAMBAH hari libur
///      di `MarketSession`). Pruning (Fase 3) akan memakai peran ini di `CordonVault`.
library Roles {
    bytes32 internal constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 internal constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
}
