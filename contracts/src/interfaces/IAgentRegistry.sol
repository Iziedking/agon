// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ContestType } from "../types/ArcRunTypes.sol";

/// @notice Slice of AgentRegistry consumed by ContestEngine and ChallengeArena.
/// @dev    Kept intentionally minimal so the settlement contracts don't depend
///         on AgentRegistry's full storage layout. `applyReputationChange` is
///         gated by CONTEST_ENGINE_ROLE on the implementation.
interface IAgentRegistry {
    function ownerOfAgent(uint256 agentId) external view returns (address);

    function getTier(uint256 agentId, ContestType cType) external view returns (uint16);

    function applyReputationChange(uint256 agentId, int128 delta) external;
}
