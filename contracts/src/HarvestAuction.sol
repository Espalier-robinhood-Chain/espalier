// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ISpurVault} from "./interfaces/ISpurVault.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title HarvestAuction
/// @notice RFQ untuk menjual opsi call mingguan SpurVault (MVP). Picker yang di-whitelist menandatangani quote
///         EIP-712 secara offchain; KEEPER memilih quote terbaik lalu mengirimnya ke `fill`. Premium dipindahkan
///         dari Picker ke vault dalam transaksi yang sama.
/// @dev - `fill` hanya bisa dipanggil KEEPER atau Picker sendiri. Selain itu siapa pun yang menyalin quote lain
///        bisa menjual round ke harga yang lebih murah daripada quote terbaik.
///      - Picker harus memberi allowance USDG ke kontrak ini. Tanda tangan mengikat vault, nomor round, strike,
///        expiry, notional, premium, dan deadline, jadi quote tidak bisa dipakai ulang di round lain.
///      - Vault hanya menerima satu penjualan per round dan hanya dari alamat ini (`ISpurVault.AUCTION`).
///      - Tanda tangan diverifikasi dengan ERC-1271 bila Picker adalah kontrak (market maker berbasis smart wallet).
///      - Mencabut Picker (`setPicker(x, false)`) langsung menolak quote-nya yang belum diisi.
///      v2 (di luar MVP): Dutch auction atau batch auction terbuka.
contract HarvestAuction is EIP712, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Quote {
        address vault;
        address picker;
        uint64 round;
        uint256 strikeE18;
        uint64 expiry;
        uint256 notional;
        uint256 premium;
        uint64 deadline;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address vault,address picker,uint64 round,uint256 strikeE18,uint64 expiry,uint256 notional,uint256 premium,uint64 deadline)"
    );

    mapping(address => bool) public isPicker;
    mapping(bytes32 => bool) public filled;

    error ZeroAddress();
    error NotAuthorized();
    error PickerNotAllowed();
    error QuoteExpired();
    error WrongAuction();
    error BadSignature();
    error AlreadyFilled();

    event PickerSet(address indexed picker, bool allowed);
    event Filled(
        address indexed vault,
        address indexed picker,
        uint64 indexed round,
        uint256 premium,
        uint256 strikeE18,
        uint64 expiry,
        uint256 notional,
        bytes32 digest
    );

    constructor(address admin) EIP712("EspalierHarvestAuction", "1") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setPicker(address picker, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (picker == address(0)) revert ZeroAddress();
        isPicker[picker] = allowed;
        emit PickerSet(picker, allowed);
    }

    /// Hash EIP-712 yang harus ditandatangani Picker.
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH, q.vault, q.picker, q.round, q.strikeE18, q.expiry, q.notional, q.premium, q.deadline
                )
            )
        );
    }

    /// Mengisi quote: premium USDG pindah dari Picker ke vault, lalu vault mencatat penjualan round aktif.
    function fill(Quote calldata q, bytes calldata signature) external nonReentrant {
        if (msg.sender != q.picker && !hasRole(Roles.KEEPER_ROLE, msg.sender)) revert NotAuthorized();
        if (!isPicker[q.picker]) revert PickerNotAllowed();
        if (block.timestamp > q.deadline) revert QuoteExpired();
        ISpurVault vault = ISpurVault(q.vault);
        if (vault.AUCTION() != address(this)) revert WrongAuction();

        bytes32 digest = hashQuote(q);
        if (!SignatureChecker.isValidSignatureNow(q.picker, digest, signature)) revert BadSignature();
        if (filled[digest]) revert AlreadyFilled();
        filled[digest] = true;

        vault.PREMIUM().safeTransferFrom(q.picker, q.vault, q.premium);
        vault.recordSale(q.picker, q.round, q.strikeE18, q.expiry, q.notional, q.premium);
        emit Filled(q.vault, q.picker, q.round, q.premium, q.strikeE18, q.expiry, q.notional, digest);
    }
}
