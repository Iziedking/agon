// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonArena } from "../src/AgonArena.sol";

contract AgonArenaIdentity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonArenaTest is Test {
    AgonArenaIdentity internal identity;
    AgonProfileRegistry internal profiles;
    AgonServiceRegistry internal services;
    AgonArena internal arena;

    address internal admin = makeAddr("admin");
    address internal provider = makeAddr("provider");
    address internal stranger = makeAddr("stranger");
    address internal validationRegistry = makeAddr("validation-registry");
    bytes32 internal constant REQUEST_HASH = keccak256("request-1");
    bytes32 internal constant CAPABILITY_HASH = keccak256("capability");
    bytes32 internal constant EVALUATOR_VERSION = keccak256("evaluator-v1");
    bytes32 internal constant TASK_COMMITMENT = keccak256("hidden-task");
    bytes32 internal constant EVIDENCE_ROOT = keccak256("evidence");
    bytes32 internal constant RESPONSE_HASH = keccak256("response");

    function setUp() public {
        identity = new AgonArenaIdentity();
        profiles = new AgonProfileRegistry(admin, address(identity));
        services = new AgonServiceRegistry(admin, address(profiles));
        arena = new AgonArena(admin, address(profiles), address(services), validationRegistry);
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://profile");
        vm.prank(provider);
        services.publish(
            42,
            keccak256("secure-review"),
            keccak256("manifest-v1"),
            "ipfs://manifest-v1",
            3,
            AgonServiceRegistry.PaymentRail.X402
        );
        vm.startPrank(admin);
        services.grantRole(services.VERIFIER_ROLE(), admin);
        services.setVerification(1, AgonServiceRegistry.Verification.Verified);
        arena.grantRole(arena.EVALUATOR_ROLE(), admin);
        vm.stopPrank();
    }

    function _request() internal returns (uint256 evaluationId) {
        vm.prank(provider);
        return arena.requestEvaluation(
            REQUEST_HASH, 1, CAPABILITY_HASH, EVALUATOR_VERSION, TASK_COMMITMENT, uint64(block.timestamp + 7 days)
        );
    }

    function test_requestPinsListingAndValidationAnchor() public {
        uint256 id = _request();
        AgonArena.Evaluation memory evaluation = arena.getEvaluation(id);
        assertEq(evaluation.listingId, 1);
        assertEq(evaluation.agentId, 42);
        assertEq(evaluation.listingVersion, 1);
        assertEq(evaluation.category, 3);
        assertEq(evaluation.participant, provider);
        assertEq(evaluation.manifestHash, keccak256("manifest-v1"));
        assertEq(evaluation.validationRequestHash, REQUEST_HASH);
        assertEq(arena.validationRegistry(), validationRegistry);
        assertEq(uint8(evaluation.state), uint8(AgonArena.State.Pending));
    }

    function test_requestRejectsNonOwnerAndDuplicateHash() public {
        vm.prank(stranger);
        vm.expectRevert(AgonArena.WrongParticipant.selector);
        arena.requestEvaluation(
            REQUEST_HASH, 1, CAPABILITY_HASH, EVALUATOR_VERSION, TASK_COMMITMENT, uint64(block.timestamp + 1 days)
        );
        _request();
        vm.prank(provider);
        vm.expectRevert(AgonArena.RequestAlreadyUsed.selector);
        arena.requestEvaluation(
            REQUEST_HASH, 1, CAPABILITY_HASH, EVALUATOR_VERSION, TASK_COMMITMENT, uint64(block.timestamp + 1 days)
        );
    }

    function test_evaluationLifecyclePassesAndCanBeRevoked() public {
        uint256 id = _request();
        vm.prank(admin);
        arena.startEvaluation(id);
        vm.prank(provider);
        arena.submitEvidence(id, EVIDENCE_ROOT);
        vm.prank(admin);
        arena.scoreEvaluation(id, 83, RESPONSE_HASH);

        AgonArena.Evaluation memory verified = arena.getEvaluation(id);
        assertEq(uint8(verified.state), uint8(AgonArena.State.Verified));
        assertEq(verified.score, 83);
        assertEq(verified.evidenceRoot, EVIDENCE_ROOT);

        vm.prank(admin);
        arena.revokeEvaluation(id, keccak256("credential-revoked"));
        assertEq(uint8(arena.getEvaluation(id).state), uint8(AgonArena.State.Revoked));
    }

    function test_failingScoreIsRejectedAndCannotBeUsedAsVerified() public {
        uint256 id = _request();
        vm.prank(admin);
        arena.startEvaluation(id);
        vm.prank(provider);
        arena.submitEvidence(id, EVIDENCE_ROOT);
        vm.prank(admin);
        arena.scoreEvaluation(id, 49, RESPONSE_HASH);
        assertEq(uint8(arena.getEvaluation(id).state), uint8(AgonArena.State.Rejected));
        vm.prank(admin);
        vm.expectRevert(AgonArena.InvalidState.selector);
        arena.startEvaluation(id);
    }

    function test_expiryClosesPendingEvaluation() public {
        uint256 id = _request();
        vm.warp(block.timestamp + 7 days);
        arena.expireEvaluation(id);
        assertEq(uint8(arena.getEvaluation(id).state), uint8(AgonArena.State.Expired));
    }

    function test_listingVersionChangesDoNotRewriteEvaluationScope() public {
        uint256 id = _request();
        bytes32 newManifest = keccak256("manifest-v2");
        vm.prank(provider);
        services.publishVersion(1, newManifest, "ipfs://manifest-v2", AgonServiceRegistry.PaymentRail.X402);
        AgonArena.Evaluation memory evaluation = arena.getEvaluation(id);
        assertEq(evaluation.listingVersion, 1);
        assertEq(evaluation.manifestHash, keccak256("manifest-v1"));
    }
}
