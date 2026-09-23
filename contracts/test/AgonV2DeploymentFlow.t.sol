// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistryV2 } from "../src/AgonServiceRegistryV2.sol";
import { AgonArena } from "../src/AgonArena.sol";
import { AgonArenaV2 } from "../src/AgonArenaV2.sol";
import { DeployAgonServiceRegistryV2 } from "../script/DeployAgonServiceRegistryV2.s.sol";

contract LocalAgentIdentity is ERC721 {
    constructor() ERC721("Local Agent", "LAGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract LocalValidationRegistry { }

/// @notice Exercises the deployment script and a provider-to-market verification loop on a local VM.
/// @dev No external registry, hosted file, indexer, or buyer payment is used in this proof.
contract AgonV2DeploymentFlowTest is Test {
    uint256 private constant LOCAL_KEY = 0xA11CE;
    uint256 private constant AGENT_ID = 42;

    address private admin;
    AgonProfileRegistry private profiles;
    LocalAgentIdentity private identity;
    LocalValidationRegistry private validation;

    function setUp() public {
        vm.chainId(5_042_002);
        admin = vm.addr(LOCAL_KEY);
        identity = new LocalAgentIdentity();
        validation = new LocalValidationRegistry();
        profiles = new AgonProfileRegistry(admin, address(identity));
        identity.mint(admin, AGENT_ID);
        vm.prank(admin);
        profiles.bindProfile(AGENT_ID, "https://example.invalid/agents/42");

        vm.setEnv("PRIVATE_KEY", vm.toString(LOCAL_KEY));
        vm.setEnv("AGON_ADMIN_ADDRESS", vm.toString(admin));
        vm.setEnv("AGON_VERIFIER_ADDRESS", vm.toString(admin));
        vm.setEnv("AGON_PROFILE_REGISTRY_ADDRESS", vm.toString(address(profiles)));
        vm.setEnv("AGON_VALIDATION_REGISTRY_ADDRESS", vm.toString(address(validation)));
    }

    function test_deploymentScriptLinksArenaAndVerifiesOnlyTheReviewedVersion() public {
        DeployAgonServiceRegistryV2 script = new DeployAgonServiceRegistryV2();
        (AgonServiceRegistryV2 services, AgonArenaV2 arena) = script.run();

        assertEq(address(arena.services()), address(services));
        assertEq(address(arena.profiles()), address(profiles));
        assertEq(arena.validationRegistry(), address(validation));
        assertTrue(arena.hasRole(arena.EVALUATOR_ROLE(), admin));
        assertTrue(services.hasRole(services.VERIFIER_ROLE(), admin));

        bytes32 firstHash = keccak256("stable-service-v1");
        vm.prank(admin);
        uint256 listingId = services.publish(
            AGENT_ID,
            keccak256("service-key"),
            firstHash,
            "https://example.invalid/services/42/v1.json",
            4,
            AgonServiceRegistryV2.PaymentRail.X402
        );
        assertEq(listingId, 1);

        uint256 firstEvaluation = _review(arena, listingId, "v1");
        assertEq(arena.getEvaluation(firstEvaluation).listingVersion, 1);
        assertEq(arena.getEvaluation(firstEvaluation).manifestHash, firstHash);
        assertEq(
            uint8(services.getListing(listingId).verification), uint8(AgonServiceRegistryV2.Verification.Unverified)
        );

        vm.prank(admin);
        services.setVerificationForVersion(listingId, 1, firstHash, AgonServiceRegistryV2.Verification.Verified);
        assertEq(uint8(services.getListing(listingId).verification), uint8(AgonServiceRegistryV2.Verification.Verified));

        bytes32 nextHash = keccak256("stable-service-v2");
        vm.prank(admin);
        services.publishVersion(
            listingId, nextHash, "https://example.invalid/services/42/v2.json", AgonServiceRegistryV2.PaymentRail.X402
        );
        assertEq(services.getListing(listingId).version, 2);
        assertEq(
            uint8(services.getListing(listingId).verification), uint8(AgonServiceRegistryV2.Verification.Unverified)
        );

        vm.prank(admin);
        vm.expectRevert(AgonServiceRegistryV2.VerificationScopeChanged.selector);
        services.setVerificationForVersion(listingId, 1, firstHash, AgonServiceRegistryV2.Verification.Verified);

        uint256 nextEvaluation = _review(arena, listingId, "v2");
        assertEq(arena.getEvaluation(nextEvaluation).listingVersion, 2);
        assertEq(arena.getEvaluation(nextEvaluation).manifestHash, nextHash);
        vm.prank(admin);
        services.setVerificationForVersion(listingId, 2, nextHash, AgonServiceRegistryV2.Verification.Verified);
        assertEq(uint8(services.getListing(listingId).verification), uint8(AgonServiceRegistryV2.Verification.Verified));
    }

    function _review(AgonArenaV2 arena, uint256 listingId, string memory versionLabel)
        private
        returns (uint256 evaluationId)
    {
        vm.prank(admin);
        evaluationId = arena.requestEvaluation(
            keccak256(abi.encodePacked("request-", versionLabel)),
            listingId,
            keccak256("capability"),
            keccak256("evaluator-build"),
            keccak256(abi.encodePacked("task-", versionLabel)),
            uint64(block.timestamp + 1 hours)
        );
        vm.prank(admin);
        arena.startEvaluation(evaluationId);
        vm.prank(admin);
        arena.submitEvidence(evaluationId, keccak256(abi.encodePacked("evidence-", versionLabel)));
        vm.prank(admin);
        arena.scoreEvaluation(evaluationId, 100, keccak256(abi.encodePacked("validation-", versionLabel)));
        assertEq(uint8(arena.getEvaluation(evaluationId).state), uint8(AgonArena.State.Verified));
    }
}
