// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IOracleRouter} from "./interfaces/IOracleRouter.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {IMarketSession} from "./interfaces/IMarketSession.sol";
import {PriceMath} from "./libraries/PriceMath.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title OracleRouter
/// @notice Membaca harga Chainlink per Stock Token dengan validasi: sequencer uptime, advisory pause oracle,
///         answer > 0, round valid, dan staleness. Semua kegagalan fail-closed.
/// @dev Fase 2 item 2 (validasi) dan item 3 (staleness sadar sesi pasar 24/5). Harga feed sudah per token
///      (ekuitas x uiMultiplier), jadi router tidak mengalikan multiplier.
///
///      Peran (item 5): ADMIN (`DEFAULT_ADMIN_ROLE`, dipegang TimelockController 48 jam) mengatur aset dan jendela
///      dan satu-satunya yang bisa `unpauseAsset`. GUARDIAN hanya bisa `pauseAsset` (langsung, tanpa jeda waktu).
///      Aset yang dijeda menghasilkan `Status.AssetPaused` di semua jalur harga, tanpa memeriksa feed. Jeda
///      bertahan melewati `setAsset`/`removeAsset` (hanya `unpauseAsset` yang melepasnya).
///
///      Staleness sadar sesi: tiap aset punya tiga jendela (Regular, Extended, Overnight). Saat sesi terbuka,
///      umur harga = block.timestamp - updatedAt dibandingkan jendela sesi saat ini; harga hasil pre-sesi tidak
///      dianggap segar sampai feed memperbarui (konservatif terhadap gap pembukaan). Saat Closed, feed menahan
///      harga terakhir tanpa heartbeat, jadi kesegaran dinilai pada saat pasar tutup (`lastOpenEnd`), dengan
///      jendela sesi terakhir sebelum tutup. `getPrice`/`tryGetPrice` menolak saat Closed (MarketClosed);
///      `getReferencePrice`/`tryGetReferencePrice` menerimanya (tampilan NAV, redeem in-kind).
contract OracleRouter is IOracleRouter, AccessControl {
    struct Asset {
        IAggregatorV3 feed;
        uint32 stalenessRegular;
        uint32 stalenessExtended;
        uint32 stalenessOvernight;
        bool checkOraclePause;
    }

    struct Round {
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 answeredInRound;
        uint8 decimals;
    }

    /// Batas atas hardcode maxStaleness.
    uint32 public constant MAX_STALENESS_LIMIT = 7 days;
    /// Batas atas hardcode grace period sequencer.
    uint256 public constant MAX_SEQUENCER_GRACE = 1 days;
    bytes32 public constant GUARDIAN_ROLE = Roles.GUARDIAN_ROLE;
    uint8 public constant MAX_FEED_DECIMALS = PriceMath.MAX_FEED_DECIMALS;
    /// Presisi keluaran router.
    uint8 public constant PRICE_DECIMALS = PriceMath.PRICE_DECIMALS;

    /// Sequencer Uptime Feed. address(0) = pemeriksaan sequencer mati (hanya untuk testnet tanpa feed).
    IAggregatorV3 public immutable sequencerFeed;
    uint256 public immutable sequencerGracePeriod;
    /// Kalender sesi pasar (item 3). Wajib ada.
    IMarketSession public immutable marketSession;

    mapping(address token => Asset) private _assets;
    mapping(address token => bool) private _assetPaused;

    event AssetConfigured(
        address indexed token,
        address indexed feed,
        uint32 stalenessRegular,
        uint32 stalenessExtended,
        uint32 stalenessOvernight,
        bool checkOraclePause
    );
    event AssetRemoved(address indexed token);
    event AssetPauseSet(address indexed token, bool paused, address indexed by);
    event SequencerCheckConfigured(address indexed feed, uint256 gracePeriod);

    error ZeroAddress();
    error InvalidMaxStaleness();
    error InvalidFeed();
    error InvalidGracePeriod();
    error InvalidMarketSession();
    error AssetNotConfigured();

    constructor(address admin, address sequencerFeed_, uint256 gracePeriod, address marketSession_) {
        if (admin == address(0) || marketSession_ == address(0)) revert ZeroAddress();
        if (marketSession_.code.length == 0) revert InvalidMarketSession();
        if (gracePeriod > MAX_SEQUENCER_GRACE) revert InvalidGracePeriod();
        if (sequencerFeed_ != address(0) && sequencerFeed_.code.length == 0) revert InvalidFeed();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        sequencerFeed = IAggregatorV3(sequencerFeed_);
        sequencerGracePeriod = gracePeriod;
        marketSession = IMarketSession(marketSession_);
        emit SequencerCheckConfigured(sequencerFeed_, gracePeriod);
    }

    // ---------------------------------------------------------------- admin

    /// Satu jendela staleness untuk ketiga sesi aktif.
    function setAsset(address token, address feed, uint32 maxStaleness, bool checkOraclePause)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setAsset(token, feed, maxStaleness, maxStaleness, maxStaleness, checkOraclePause);
    }

    /// Jendela staleness berbeda per sesi (mis. Regular ketat, Overnight longgar karena likuiditas tipis).
    function setAssetWindows(
        address token,
        address feed,
        uint32 stalenessRegular,
        uint32 stalenessExtended,
        uint32 stalenessOvernight,
        bool checkOraclePause
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setAsset(token, feed, stalenessRegular, stalenessExtended, stalenessOvernight, checkOraclePause);
    }

    /// Jeda aset: GUARDIAN atau ADMIN, langsung berlaku. Hanya untuk aset yang terdaftar. Tidak memindahkan dana.
    function pauseAsset(address token) external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        if (address(_assets[token].feed) == address(0)) revert AssetNotConfigured();
        if (_assetPaused[token]) return;
        _assetPaused[token] = true;
        emit AssetPauseSet(token, true, msg.sender);
    }

    /// Buka jeda: hanya ADMIN (lewat timelock di produksi). Boleh untuk aset yang sudah dihapus.
    function unpauseAsset(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_assetPaused[token]) return;
        _assetPaused[token] = false;
        emit AssetPauseSet(token, false, msg.sender);
    }

    function removeAsset(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        delete _assets[token];
        emit AssetRemoved(token);
    }

    function _setAsset(
        address token,
        address feed,
        uint32 stalenessRegular,
        uint32 stalenessExtended,
        uint32 stalenessOvernight,
        bool checkOraclePause
    ) internal {
        if (token == address(0) || feed == address(0)) revert ZeroAddress();
        if (_badWindow(stalenessRegular) || _badWindow(stalenessExtended) || _badWindow(stalenessOvernight)) {
            revert InvalidMaxStaleness();
        }
        // try/catch tidak menangkap panggilan ke alamat tanpa kode, jadi diperiksa di depan.
        if (feed.code.length == 0 || token.code.length == 0) revert InvalidFeed();
        try IAggregatorV3(feed).decimals() returns (uint8 d) {
            if (d > MAX_FEED_DECIMALS) revert InvalidFeed();
        } catch {
            revert InvalidFeed();
        }
        _assets[token] = Asset({
            feed: IAggregatorV3(feed),
            stalenessRegular: stalenessRegular,
            stalenessExtended: stalenessExtended,
            stalenessOvernight: stalenessOvernight,
            checkOraclePause: checkOraclePause
        });
        emit AssetConfigured(token, feed, stalenessRegular, stalenessExtended, stalenessOvernight, checkOraclePause);
    }

    function _badWindow(uint32 w) private pure returns (bool) {
        return w == 0 || w > MAX_STALENESS_LIMIT;
    }

    // ----------------------------------------------------------------- views

    /// @inheritdoc IOracleRouter
    function isAssetPaused(address token) external view returns (bool) {
        return _assetPaused[token];
    }

    function sequencerCheckEnabled() external view returns (bool) {
        return address(sequencerFeed) != address(0);
    }

    function assetConfig(address token) external view returns (Asset memory) {
        return _assets[token];
    }

    /// @inheritdoc IOracleRouter
    function feedOf(address token) external view returns (address feed, bool checkOraclePause) {
        Asset storage a = _assets[token];
        return (address(a.feed), a.checkOraclePause);
    }

    /// @inheritdoc IOracleRouter
    function freshnessReference(address token, uint256 ts)
        external
        view
        returns (uint256 refTime, uint32 window, IMarketSession.Session session)
    {
        return _freshnessRef(_assets[token], ts);
    }

    /// @inheritdoc IOracleRouter
    function getPrice(address token) external view returns (uint256 priceE18, uint256 updatedAt) {
        Status status;
        (status, priceE18, updatedAt,) = _read(token, true);
        if (status != Status.Ok) revert PriceUnavailable(status);
    }

    /// @inheritdoc IOracleRouter
    function tryGetPrice(address token) external view returns (Status status, uint256 priceE18, uint256 updatedAt) {
        (status, priceE18, updatedAt,) = _read(token, true);
    }

    /// @inheritdoc IOracleRouter
    function getReferencePrice(address token)
        external
        view
        returns (uint256 priceE18, uint256 updatedAt, IMarketSession.Session session)
    {
        Status status;
        (status, priceE18, updatedAt, session) = _read(token, false);
        if (status != Status.Ok) revert PriceUnavailable(status);
    }

    /// @inheritdoc IOracleRouter
    function tryGetReferencePrice(address token)
        external
        view
        returns (Status status, uint256 priceE18, uint256 updatedAt, IMarketSession.Session session)
    {
        return _read(token, false);
    }

    // -------------------------------------------------------------- internal

    function _window(Asset memory a, IMarketSession.Session s) private pure returns (uint32) {
        if (s == IMarketSession.Session.Regular) return a.stalenessRegular;
        if (s == IMarketSession.Session.Extended) return a.stalenessExtended;
        return a.stalenessOvernight; // Overnight; Closed tidak pernah menjadi sesi acuan
    }

    /// Titik acuan kesegaran pada `ts`. Sesi terbuka: (ts, jendela sesi itu). Closed: (awal periode tutup, jendela
    /// sesi terakhir sebelum tutup). refTime 0 = periode tutup tidak terlacak (dianggap tidak segar).
    function _freshnessRef(Asset memory a, uint256 ts)
        internal
        view
        returns (uint256 refTime, uint32 window, IMarketSession.Session session)
    {
        session = marketSession.sessionAt(ts);
        if (session != IMarketSession.Session.Closed) return (ts, _window(a, session), session);
        refTime = marketSession.lastOpenEnd(ts);
        if (refTime == 0) return (0, 0, session);
        // Sesi tepat sebelum tutup; terbuka menurut definisi `lastOpenEnd`.
        window = _window(a, marketSession.sessionAt(refTime - 1));
    }

    /// `live`: tolak sesi Closed. Bukan live: terima harga yang masih segar pada saat tutup.
    // slither-disable-next-line timestamp
    function _read(address token, bool live) internal view returns (Status, uint256, uint256, IMarketSession.Session) {
        Asset memory a = _assets[token];
        if (address(a.feed) == address(0)) return (Status.UnknownAsset, 0, 0, IMarketSession.Session.Closed);
        if (_assetPaused[token]) return (Status.AssetPaused, 0, 0, IMarketSession.Session.Closed);

        Status seq = _sequencerStatus();
        if (seq != Status.Ok) return (seq, 0, 0, IMarketSession.Session.Closed);

        (uint256 refTime, uint32 window, IMarketSession.Session session) = _freshnessRef(a, block.timestamp);
        if (live && session == IMarketSession.Session.Closed) return (Status.MarketClosed, 0, 0, session);

        // Flag pause hanya advisory; staleness tetap penjaga utama. Gagal membaca flag = fail-closed.
        if (a.checkOraclePause) {
            if (token.code.length == 0) return (Status.OraclePaused, 0, 0, session);
            try IStockToken(token).oraclePaused() returns (bool paused) {
                if (paused) return (Status.OraclePaused, 0, 0, session);
            } catch {
                return (Status.OraclePaused, 0, 0, session);
            }
        }

        if (address(a.feed).code.length == 0) return (Status.FeedCallFailed, 0, 0, session);
        (bool ok, Round memory r) = _fetch(a.feed);
        if (!ok) return (Status.FeedCallFailed, 0, 0, session);

        if (r.answer <= 0 || r.decimals > MAX_FEED_DECIMALS) return (Status.InvalidAnswer, 0, 0, session);
        if (r.roundId == 0 || r.updatedAt == 0 || r.updatedAt > block.timestamp || r.answeredInRound < r.roundId) {
            return (Status.InvalidRound, 0, 0, session);
        }
        // refTime == 0: periode tutup tidak terlacak. Selain itu: segar bila updatedAt >= refTime atau umur <= jendela.
        if (refTime == 0 || (refTime > r.updatedAt && refTime - r.updatedAt > window)) {
            return (Status.Stale, 0, r.updatedAt, session);
        }

        // forge-lint: disable-next-line(unsafe-typecast)
        (bool scaled, uint256 priceE18) = PriceMath.toE18(uint256(r.answer), r.decimals); // answer > 0 sudah dipastikan di atas
        if (!scaled) return (Status.InvalidAnswer, 0, 0, session);
        return (Status.Ok, priceE18, r.updatedAt, session);
    }

    // slither-disable-next-line unused-return
    function _fetch(IAggregatorV3 feed) internal view returns (bool ok, Round memory r) {
        try feed.decimals() returns (uint8 d) {
            r.decimals = d;
        } catch {
            return (false, r);
        }
        try feed.latestRoundData() returns (uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80 air) {
            r.roundId = roundId;
            r.answer = answer;
            r.updatedAt = updatedAt;
            r.answeredInRound = air;
            ok = true;
        } catch {
            ok = false;
        }
    }

    /// Chainlink L2 Sequencer Uptime Feed: answer 0 = up, 1 = down.
    // slither-disable-next-line unused-return,timestamp
    function _sequencerStatus() internal view returns (Status) {
        if (address(sequencerFeed) == address(0)) return Status.Ok;
        if (address(sequencerFeed).code.length == 0) return Status.SequencerDown;
        try sequencerFeed.latestRoundData() returns (uint80, int256 answer, uint256 startedAt, uint256, uint80) {
            if (answer != 0) return Status.SequencerDown;
            // startedAt == 0 berarti round tidak valid; di masa depan juga tidak valid.
            if (startedAt == 0 || startedAt > block.timestamp) return Status.SequencerDown;
            if (block.timestamp - startedAt <= sequencerGracePeriod) return Status.SequencerGracePeriod;
            return Status.Ok;
        } catch {
            return Status.SequencerDown;
        }
    }
}
