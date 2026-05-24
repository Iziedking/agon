// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPrizeEscrow } from "./interfaces/IPrizeEscrow.sol";

/// @title  PrizeEscrow
/// @notice Single USDC custodian for ArcRun: sponsored contest prize pools and
///         peer-challenge pots. Also routes the two ArcRun fee types to the
///         treasury: the up-front listing fee and the platform-fee skim taken at
///         settlement. (Weekly syndicate war pools land in v1, together with
///         their distributor; v0 deliberately ships no war-pool deposit so no
///         funds can be stranded without a payout path.)
/// @dev    Pools are namespaced by `keccak256(controller, poolId)`, where the
///         controller is the calling contract (ContestEngine or ChallengeArena).
///         A controller can only ever move funds within its own pools, so the
///         two settlement contracts share this escrow without id collisions.
///         Deposit functions pull USDC from `from`, which must have approved
///         this contract. Every mutating entrypoint is CONTROLLER_ROLE-gated.
///         See ARCRUN_PLAN.md §4.5.
contract PrizeEscrow is IPrizeEscrow, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Roles ============

    /// @notice Granted to ContestEngine and ChallengeArena at deploy.
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");

    // ============ Immutables ============

    IERC20 public immutable usdc;

    // ============ Mutable state ============

    address public treasury;

    /// @dev keccak256(controller, poolId) => USDC held for that pool.
    mapping(bytes32 => uint256) private _poolBalance;

    // ============ Events ============

    event PrizePoolDeposited(address indexed controller, uint256 indexed poolId, address indexed from, uint256 amount);
    event ChallengePotDeposited(address indexed controller, uint256 indexed poolId, address indexed from, uint256 amount);
    event ListingFeeCollected(address indexed controller, address indexed from, uint256 amount);
    event PaidOut(address indexed controller, uint256 indexed poolId, address indexed recipient, uint256 amount);
    event PlatformFeeSkimmed(address indexed controller, uint256 indexed poolId, uint256 amount);
    event UnclaimedSwept(address indexed controller, uint256 indexed poolId, uint256 amount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientPoolBalance(uint256 have, uint256 want);

    // ============ Constructor ============

    constructor(address admin, address usdcAddr, address treasuryAddr) {
        if (admin == address(0)) revert ZeroAddress();
        if (usdcAddr == address(0)) revert ZeroAddress();
        if (treasuryAddr == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        usdc = IERC20(usdcAddr);
        treasury = treasuryAddr;
    }

    // ============ Deposits (controllers) ============

    /// @inheritdoc IPrizeEscrow
    function depositPrizePool(uint256 contestId, address from, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        _poolBalance[_key(msg.sender, contestId)] += amount;
        usdc.safeTransferFrom(from, address(this), amount);
        emit PrizePoolDeposited(msg.sender, contestId, from, amount);
    }

    /// @inheritdoc IPrizeEscrow
    function depositChallengePot(uint256 challengeId, address from, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        _poolBalance[_key(msg.sender, challengeId)] += amount;
        usdc.safeTransferFrom(from, address(this), amount);
        emit ChallengePotDeposited(msg.sender, challengeId, from, amount);
    }

    /// @inheritdoc IPrizeEscrow
    function collectListingFee(address from, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        // Listing fee is not escrowed; it goes straight to the treasury.
        usdc.safeTransferFrom(from, treasury, amount);
        emit ListingFeeCollected(msg.sender, from, amount);
    }

    // ============ Withdrawals (controllers) ============

    /// @inheritdoc IPrizeEscrow
    function payout(uint256 poolId, address recipient, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        _debit(_key(msg.sender, poolId), amount);
        usdc.safeTransfer(recipient, amount);
        emit PaidOut(msg.sender, poolId, recipient, amount);
    }

    /// @inheritdoc IPrizeEscrow
    function skimPlatformFee(uint256 poolId, uint256 amount)
        external
        onlyRole(CONTROLLER_ROLE)
        nonReentrant
    {
        _debit(_key(msg.sender, poolId), amount);
        usdc.safeTransfer(treasury, amount);
        emit PlatformFeeSkimmed(msg.sender, poolId, amount);
    }

    /// @inheritdoc IPrizeEscrow
    function sweepUnclaimed(uint256 poolId) external onlyRole(CONTROLLER_ROLE) nonReentrant {
        bytes32 key = _key(msg.sender, poolId);
        uint256 amount = _poolBalance[key];
        if (amount == 0) revert ZeroAmount();
        _poolBalance[key] = 0;
        usdc.safeTransfer(treasury, amount);
        emit UnclaimedSwept(msg.sender, poolId, amount);
    }

    // ============ Admin ============

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    // ============ Views ============

    /// @inheritdoc IPrizeEscrow
    function poolBalance(address controller, uint256 poolId) external view returns (uint256) {
        return _poolBalance[_key(controller, poolId)];
    }

    // ============ Internals ============

    function _debit(bytes32 key, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = _poolBalance[key];
        if (bal < amount) revert InsufficientPoolBalance(bal, amount);
        unchecked {
            _poolBalance[key] = bal - amount;
        }
    }

    function _key(address controller, uint256 poolId) private pure returns (bytes32) {
        return keccak256(abi.encode(controller, poolId));
    }
}
