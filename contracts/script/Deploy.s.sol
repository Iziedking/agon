// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { PrizeEscrow } from "../src/PrizeEscrow.sol";
import { AgentRegistry } from "../src/AgentRegistry.sol";
import { ContestEngine } from "../src/ContestEngine.sol";
import { ChallengeArena } from "../src/ChallengeArena.sol";
import { SyndicateFactory } from "../src/SyndicateFactory.sol";
import { PointsLedger } from "../src/PointsLedger.sol";

/// @title  Deploy
/// @notice Deploys the six ArcRun v0 contracts in dependency order and wires
///         the roles. Syndicates and upgrade prices are seeded in their
///         constructors, so no extra seeding step is needed.
/// @dev    Config comes from env vars with Arc testnet defaults (verified via
///         arc-docs). Required: PRIVATE_KEY. Optional: ADMIN_ADDRESS,
///         TREASURY_ADDRESS, COORDINATOR_ADDRESS, USDC_ADDRESS,
///         IDENTITY_REGISTRY_ADDRESS, LISTING_FEE, PLATFORM_FEE_BPS.
///
///         Run:
///         forge script script/Deploy.s.sol \
///           --rpc-url https://rpc.testnet.arc.network --broadcast
///
///         Role wiring runs in this script only when the admin equals the
///         deployer. If you deploy with a separate admin key (recommended for
///         production), run the grants from the admin account afterwards.
contract Deploy is Script {
    // Arc testnet defaults, verified against arc-docs.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant ARC_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    struct Deployed {
        PrizeEscrow escrow;
        AgentRegistry agentRegistry;
        ContestEngine contestEngine;
        ChallengeArena challengeArena;
        SyndicateFactory syndicateFactory;
        PointsLedger pointsLedger;
    }

    function run() external returns (Deployed memory d) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address admin = vm.envOr("ADMIN_ADDRESS", deployer);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address coordinator = vm.envOr("COORDINATOR_ADDRESS", deployer);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY_ADDRESS", ARC_IDENTITY_REGISTRY);

        // Listing fee is a percentage of the prize pool, in bps. 0 = free
        // hosting; change anytime with ContestEngine.setListingFeeBps.
        uint16 listingFeeBps = uint16(vm.envOr("LISTING_FEE_BPS", uint256(0)));
        uint16 platformFeeBps = uint16(vm.envOr("PLATFORM_FEE_BPS", uint256(500))); // 5% default

        // The coordinator posts payout roots; the treasury receives fees. Keep
        // them distinct so a compromised coordinator key cannot also be the
        // fee sink. (Audit M1.)
        require(coordinator != treasury, "coordinator must differ from treasury");

        vm.startBroadcast(deployerKey);

        d.escrow = new PrizeEscrow(admin, usdc, treasury);
        d.agentRegistry = new AgentRegistry(admin, identityRegistry, usdc, treasury);
        d.contestEngine =
            new ContestEngine(admin, address(d.agentRegistry), address(d.escrow), listingFeeBps, platformFeeBps);
        d.challengeArena = new ChallengeArena(admin, address(d.agentRegistry), address(d.escrow), platformFeeBps);
        d.syndicateFactory = new SyndicateFactory(admin);
        d.pointsLedger = new PointsLedger(admin);

        // Role wiring needs DEFAULT_ADMIN_ROLE, held by `admin`. Only possible
        // inside this broadcast when the deployer is also the admin.
        if (admin == deployer) {
            d.escrow.grantRole(d.escrow.CONTROLLER_ROLE(), address(d.contestEngine));
            d.escrow.grantRole(d.escrow.CONTROLLER_ROLE(), address(d.challengeArena));

            // Both settlement contracts push in-game reputation to AgentRegistry,
            // so both hold CONTEST_ENGINE_ROLE.
            d.agentRegistry.grantRole(d.agentRegistry.CONTEST_ENGINE_ROLE(), address(d.contestEngine));
            d.agentRegistry.grantRole(d.agentRegistry.CONTEST_ENGINE_ROLE(), address(d.challengeArena));

            d.contestEngine.grantRole(d.contestEngine.COORDINATOR_ROLE(), coordinator);
            d.challengeArena.grantRole(d.challengeArena.COORDINATOR_ROLE(), coordinator);
            d.syndicateFactory.grantRole(d.syndicateFactory.COORDINATOR_ROLE(), coordinator);

            // Coordinator credits points after agent runs.
            d.pointsLedger.grantRole(d.pointsLedger.COORDINATOR_ROLE(), coordinator);
            // ContestEngine holds the debit role for when entry fees in points
            // are wired (not called in v0, but the role belongs to the engine).
            d.pointsLedger.grantRole(d.pointsLedger.CONTEST_ENGINE_ROLE(), address(d.contestEngine));
        }

        vm.stopBroadcast();

        _report(d, admin, treasury, coordinator, listingFeeBps, platformFeeBps);
    }

    function _report(
        Deployed memory d,
        address admin,
        address treasury,
        address coordinator,
        uint16 listingFeeBps,
        uint16 platformFeeBps
    ) internal pure {
        console2.log("=== ArcRun v0 deployed ===");
        console2.log("PrizeEscrow:     ", address(d.escrow));
        console2.log("AgentRegistry:   ", address(d.agentRegistry));
        console2.log("ContestEngine:   ", address(d.contestEngine));
        console2.log("ChallengeArena:  ", address(d.challengeArena));
        console2.log("SyndicateFactory:", address(d.syndicateFactory));
        console2.log("PointsLedger:    ", address(d.pointsLedger));
        console2.log("--- config ---");
        console2.log("admin:           ", admin);
        console2.log("treasury:        ", treasury);
        console2.log("coordinator:     ", coordinator);
        console2.log("listingFeeBps:   ", listingFeeBps);
        console2.log("platformFeeBps:  ", platformFeeBps);
    }
}
