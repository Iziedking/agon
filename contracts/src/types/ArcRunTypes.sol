// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev File-scope enums shared by every ArcRun contract. Defined here so
/// PointsLedger / ContestEngine / AgentRegistry can import the same symbol
/// without creating an import cycle.
enum ContestType {
    SCOUT,
    ANALYST,
    SOLVER
}

enum ContestStatus {
    PENDING,
    OPEN,
    SCORING,
    SETTLED,
    CANCELLED
}

/// @dev Kinds of peer-to-peer challenge in ChallengeArena. PREDICTION and PUZZLE
/// ship first; VOLUME (mini sponsor-style) and CUSTOM follow.
enum ChallengeKind {
    PREDICTION,
    PUZZLE,
    VOLUME,
    CUSTOM
}

/// @dev Lifecycle of a ChallengeArena challenge.
enum ChallengeStatus {
    OPEN,
    LOCKED,
    SETTLED,
    CANCELLED
}
