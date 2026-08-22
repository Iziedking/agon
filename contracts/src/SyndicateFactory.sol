// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title  SyndicateFactory
/// @notice The four founding syndicates (teams) and their membership, plus the
///         weekly-war meta-game. Operators belong to at most one syndicate at a
///         time and can switch. Contest reputation can be attributed to a
///         member's syndicate to drive team leaderboards and weekly wars.
/// @dev    v0 ships the four founding syndicates (seeded in the constructor),
///         join/switch/leave, coordinator-recorded reputation contribution, and
///         coordinator-settled weekly war results (recorded and emitted for the
///         indexer). On-chain USDC distribution of a syndicate war pool is a v1
///         refinement (a merkle distributor against the PrizeEscrow war pool);
///         v0 records standings only. Custom syndicate creation is gated behind
///         an admin toggle (a v1 revenue feature, see ARCRUN_PLAN.md §9.2).
///         See ARCRUN_PLAN.md §4.4.
contract SyndicateFactory is AccessControl {
    // ============ Roles ============

    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    // ============ Types ============

    struct Syndicate {
        uint256 id;
        string name;
        string theme; // visual / narrative identity
        address founder; // address(0) for founding syndicates
        uint128 totalReputation;
        uint64 memberCount;
        bool isCustom;
        uint16 platformFeeBps; // share to platform for custom syndicates (v1)
    }

    struct Membership {
        uint256 syndicateId;
        uint64 joinedAt;
        uint128 contribution; // reputation this member has contributed
    }

    // ============ State ============

    uint256 private _nextSyndicateId = 1; // id 0 reserved for "no syndicate"
    mapping(uint256 => Syndicate) private _syndicates;

    /// @notice Operator => their current syndicate id (0 = none).
    mapping(address => uint256) public currentSyndicate;
    /// @notice syndicateId => operator => membership record.
    mapping(uint256 => mapping(address => Membership)) private _memberships;

    /// @notice Monotonic counter of settled weekly wars.
    uint256 public weekCount;

    /// @notice Whether operators can create custom syndicates (v1 feature).
    bool public customCreationEnabled;

    /// @notice Default platform fee (bps) stamped onto custom syndicates.
    uint16 public customPlatformFeeBps = 1000; // 10%

    // ============ Events ============

    event SyndicateCreated(uint256 indexed id, address indexed founder, string name);
    event MemberJoined(uint256 indexed syndicateId, address indexed member);
    event MemberLeft(uint256 indexed syndicateId, address indexed member);
    event ContributionRecorded(uint256 indexed syndicateId, address indexed member, uint128 amount);
    event WeeklyWarSettled(uint256 indexed weekId, uint256[] syndicateIds, uint256[] pointsTotals);
    event CustomCreationToggled(bool enabled);
    event CustomPlatformFeeUpdated(uint16 oldBps, uint16 newBps);

    // ============ Errors ============

    error ZeroAddress();
    error EmptyName();
    error SyndicateDoesNotExist();
    error AlreadyInSyndicate(uint256 syndicateId);
    error NotInSyndicate();
    error CustomCreationDisabled();
    error LengthMismatch();
    error FeeTooHigh();

    // ============ Constructor ============

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        _seedFounding("Arc Crimson", "the aggressive operators, MEV and arbitrage");
        _seedFounding("Arc Cyan", "the analysts, prediction specialists");
        _seedFounding("Arc Gold", "the builders, liquidity and protocol activity");
        _seedFounding("Arc Violet", "the solvers, puzzle and algorithm specialists");
    }

    function _seedFounding(string memory name, string memory theme) private {
        uint256 id = _nextSyndicateId++;
        _syndicates[id] = Syndicate({
            id: id,
            name: name,
            theme: theme,
            founder: address(0),
            totalReputation: 0,
            memberCount: 0,
            isCustom: false,
            platformFeeBps: 0
        });
        emit SyndicateCreated(id, address(0), name);
    }

    // ============ Membership ============

    /// @notice Join `syndicateId`, automatically leaving any current syndicate
    ///         first (switching is allowed). Reverts if already a member of the
    ///         target.
    function joinSyndicate(uint256 syndicateId) external {
        Syndicate storage target = _syndicates[syndicateId];
        if (target.id == 0) revert SyndicateDoesNotExist();

        uint256 current = currentSyndicate[msg.sender];
        if (current == syndicateId) revert AlreadyInSyndicate(syndicateId);
        if (current != 0) _leave(current);

        currentSyndicate[msg.sender] = syndicateId;
        target.memberCount += 1;

        Membership storage m = _memberships[syndicateId][msg.sender];
        m.syndicateId = syndicateId;
        m.joinedAt = uint64(block.timestamp);
        // `contribution` persists across re-joins of the same syndicate.

        emit MemberJoined(syndicateId, msg.sender);
    }

    /// @notice Leave the caller's current syndicate.
    function leaveSyndicate() external {
        uint256 current = currentSyndicate[msg.sender];
        if (current == 0) revert NotInSyndicate();
        _leave(current);
        currentSyndicate[msg.sender] = 0;
    }

    function _leave(uint256 syndicateId) private {
        Syndicate storage s = _syndicates[syndicateId];
        if (s.memberCount > 0) s.memberCount -= 1;
        emit MemberLeft(syndicateId, msg.sender);
    }

    // ============ Coordinator path ============

    /// @notice Attribute `amount` of reputation a member earned to their current
    ///         syndicate's running total. Called by the coordinator after
    ///         contests. No-op-safe: reverts if the member isn't in a syndicate.
    function recordContribution(address member, uint128 amount) external onlyRole(COORDINATOR_ROLE) {
        uint256 syndicateId = currentSyndicate[member];
        if (syndicateId == 0) revert NotInSyndicate();

        _syndicates[syndicateId].totalReputation += amount;
        _memberships[syndicateId][member].contribution += amount;

        emit ContributionRecorded(syndicateId, member, amount);
    }

    /// @notice Record the result of a weekly war. Coordinator passes the ranked
    ///         syndicate ids and their point totals; this stamps a week id and
    ///         emits the standings for the indexer. (USDC distribution of the
    ///         war pool is a v1 refinement.)
    function settleWeeklyWar(uint256[] calldata syndicateIds, uint256[] calldata pointsTotals)
        external
        onlyRole(COORDINATOR_ROLE)
        returns (uint256 weekId)
    {
        if (syndicateIds.length != pointsTotals.length) revert LengthMismatch();

        weekId = ++weekCount;
        emit WeeklyWarSettled(weekId, syndicateIds, pointsTotals);
    }

    // ============ Custom syndicates (v1) ============

    /// @notice Create a custom syndicate. Disabled by default; an admin enables
    ///         it for v1. The creator becomes the founder.
    function createSyndicate(string calldata name, string calldata theme) external returns (uint256 id) {
        if (!customCreationEnabled) revert CustomCreationDisabled();
        if (bytes(name).length == 0) revert EmptyName();

        id = _nextSyndicateId++;
        _syndicates[id] = Syndicate({
            id: id,
            name: name,
            theme: theme,
            founder: msg.sender,
            totalReputation: 0,
            memberCount: 0,
            isCustom: true,
            platformFeeBps: customPlatformFeeBps
        });

        emit SyndicateCreated(id, msg.sender, name);
    }

    // ============ Admin ============

    function setCustomCreationEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        customCreationEnabled = enabled;
        emit CustomCreationToggled(enabled);
    }

    function setCustomPlatformFeeBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > 10_000) revert FeeTooHigh();
        emit CustomPlatformFeeUpdated(customPlatformFeeBps, newBps);
        customPlatformFeeBps = newBps;
    }

    // ============ Views ============

    function getSyndicate(uint256 syndicateId) external view returns (Syndicate memory) {
        return _syndicates[syndicateId];
    }

    function getMembership(uint256 syndicateId, address member) external view returns (Membership memory) {
        return _memberships[syndicateId][member];
    }

    function syndicateCount() external view returns (uint256) {
        return _nextSyndicateId - 1;
    }
}
