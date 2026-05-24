// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice External surface of PrizeEscrow used by ContestEngine and
///         ChallengeArena. Implemented in `PrizeEscrow.sol`.
/// @dev    Pool balances are namespaced by the calling controller contract,
///         i.e. the implementation keys each pool by
///         `keccak256(msg.sender, poolId)`. This lets ContestEngine (keyed by
///         contestId) and ChallengeArena (keyed by challengeId) share the same
///         escrow without id collisions. Deposit functions pull USDC from
///         `from`, which must have approved the escrow. All mutating calls are
///         restricted to authorized controllers on the implementation.
interface IPrizeEscrow {
    /// @notice Pull `amount` USDC from `from` into the pool for `contestId`.
    function depositPrizePool(uint256 contestId, address from, uint256 amount) external;

    /// @notice Pull a flat listing fee from `from` straight to the treasury.
    function collectListingFee(address from, uint256 amount) external;

    /// @notice Pull `amount` USDC from `from` into the pot for `challengeId`.
    function depositChallengePot(uint256 challengeId, address from, uint256 amount) external;

    /// @notice Pay `amount` from the caller's pool `poolId` to `recipient`.
    function payout(uint256 poolId, address recipient, uint256 amount) external;

    /// @notice Move `amount` from the caller's pool `poolId` to the treasury
    ///         (the platform-fee skim taken at settlement).
    function skimPlatformFee(uint256 poolId, uint256 amount) external;

    /// @notice Sweep the entire remaining balance of the caller's pool `poolId`
    ///         to the treasury (the 30-day unclaimed recovery path).
    function sweepUnclaimed(uint256 poolId) external;

    /// @notice Remaining USDC held for `controller`'s pool `poolId`.
    function poolBalance(address controller, uint256 poolId) external view returns (uint256);
}
