// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ContestType } from "./types/ArcRunTypes.sol";

/// @title PointsLedger
/// @notice Non-transferable, contest-issued points ("Cycles" in user-facing copy).
///         Earned from agent activity, used for contest qualification thresholds
///         and reputation calculations. Cannot be exchanged for USDC, which is
///         what keeps the design utility-based, not gambling.
/// @dev    Intentionally NOT ERC-20. No transfer/approve surface area.
///         Roles:
///           - COORDINATOR_ROLE: backend coordinator service, credits points after agent runs.
///           - CONTEST_ENGINE_ROLE: ContestEngine contract, debits points on contest entry.
///         Decay is documented in the plan but unspecified, so it is left as a
///         v1 hook via `lastEarnAt` (captured but not yet consumed).
contract PointsLedger is AccessControl {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    bytes32 public constant CONTEST_ENGINE_ROLE = keccak256("CONTEST_ENGINE_ROLE");

    struct Account {
        uint128 balance;
        uint64 lastEarnAt;
        uint128 lifetimePoints;
    }

    mapping(address => Account) private _accounts;

    event PointsCredited(
        address indexed operator,
        uint128 amount,
        uint256 indexed contestId,
        ContestType cType
    );

    event PointsDebited(
        address indexed operator,
        uint128 amount,
        uint256 indexed contestId
    );

    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint128 have, uint128 want);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Credit points to an operator. Only callable by COORDINATOR_ROLE.
    /// @dev    `lifetimePoints` is monotonic and never decremented; `balance` is
    ///         what the operator can spend on entries.
    function credit(
        address operator,
        uint128 amount,
        uint256 contestId,
        ContestType cType
    ) external onlyRole(COORDINATOR_ROLE) {
        if (operator == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        Account storage a = _accounts[operator];
        a.balance += amount;
        a.lifetimePoints += amount;
        a.lastEarnAt = uint64(block.timestamp);

        emit PointsCredited(operator, amount, contestId, cType);
    }

    /// @notice Debit points from an operator (e.g. paying a contest entry fee
    ///         denominated in points). Only callable by CONTEST_ENGINE_ROLE.
    function debit(
        address operator,
        uint128 amount,
        uint256 contestId
    ) external onlyRole(CONTEST_ENGINE_ROLE) {
        if (amount == 0) revert ZeroAmount();

        Account storage a = _accounts[operator];
        if (a.balance < amount) revert InsufficientBalance(a.balance, amount);
        unchecked {
            a.balance -= amount;
        }

        emit PointsDebited(operator, amount, contestId);
    }

    function balanceOf(address operator) public view returns (uint128) {
        return _accounts[operator].balance;
    }

    function lifetimeOf(address operator) external view returns (uint128) {
        return _accounts[operator].lifetimePoints;
    }

    function accountOf(address operator) external view returns (Account memory) {
        return _accounts[operator];
    }
}
