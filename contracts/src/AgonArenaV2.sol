// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AgonArena } from "./AgonArena.sol";

/// @notice A separate Arena deployment pinned to the version-scoped service registry.
/// @dev The deployed Arena stores its registry address immutably, so it cannot review V2 listings.
contract AgonArenaV2 is AgonArena {
    constructor(
        address admin,
        address profileRegistry,
        address serviceRegistryV2,
        address validationRegistry,
        address evaluator
    ) AgonArena(admin, profileRegistry, serviceRegistryV2, validationRegistry) {
        if (evaluator == address(0)) revert ZeroAddress();
        _grantRole(EVALUATOR_ROLE, evaluator);
    }
}
