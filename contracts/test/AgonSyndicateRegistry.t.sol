// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonSyndicateRegistry } from "../src/AgonSyndicateRegistry.sol";

contract AgonSyndicateIdentity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonSyndicateRegistryTest is Test {
    AgonSyndicateIdentity internal identity;
    AgonProfileRegistry internal profiles;
    AgonSyndicateRegistry internal syndicates;
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        identity = new AgonSyndicateIdentity();
        profiles = new AgonProfileRegistry(admin, address(identity));
        syndicates = new AgonSyndicateRegistry(admin, address(profiles));
        identity.mint(alice, 1);
        identity.mint(bob, 2);
        vm.prank(alice);
        profiles.bindProfile(1, "ipfs://alice");
        vm.prank(bob);
        profiles.bindProfile(2, "ipfs://bob");
    }

    function _create() internal returns (uint256 id) {
        vm.prank(alice);
        return syndicates.createSyndicate(keccak256("name"), keccak256("campaign"));
    }

    function test_rosterLocksAndSnapshotsEachAgentOwner() public {
        uint256 id = _create();
        vm.prank(alice);
        syndicates.joinSyndicate(id, 1);
        vm.prank(bob);
        syndicates.joinSyndicate(id, 2);
        vm.prank(alice);
        syndicates.lockRoster(id);

        AgonSyndicateRegistry.Syndicate memory syndicate = syndicates.getSyndicate(id);
        assertEq(uint8(syndicate.state), uint8(AgonSyndicateRegistry.State.Locked));
        assertEq(syndicate.memberCount, 2);
        assertEq(syndicates.getMember(id, 1).ownerSnapshot, alice);
        assertEq(syndicates.getMember(id, 2).ownerSnapshot, bob);
    }

    function test_joinRequiresCurrentAgentOwnerAndLockedRosterRejectsChanges() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert(AgonSyndicateRegistry.NotAgentOwner.selector);
        syndicates.joinSyndicate(id, 1);
        vm.prank(alice);
        syndicates.joinSyndicate(id, 1);
        vm.prank(alice);
        syndicates.lockRoster(id);
        vm.prank(bob);
        vm.expectRevert(AgonSyndicateRegistry.InvalidState.selector);
        syndicates.joinSyndicate(id, 2);
    }

    function test_contributionsAreEvidenceKeyedAndSettlementIsTerminal() public {
        uint256 id = _create();
        vm.prank(alice);
        syndicates.joinSyndicate(id, 1);
        vm.prank(alice);
        syndicates.lockRoster(id);
        vm.prank(admin);
        syndicates.startCompetition(id);
        bytes32 key = keccak256("contribution-1");
        vm.prank(admin);
        syndicates.recordContribution(id, 1, key, 75, keccak256("evidence-1"));
        assertEq(syndicates.getMember(id, 1).contributionScore, 75);
        vm.prank(admin);
        vm.expectRevert(AgonSyndicateRegistry.ContributionAlreadyRecorded.selector);
        syndicates.recordContribution(id, 1, key, 100, keccak256("evidence-2"));
        vm.prank(admin);
        syndicates.settleCampaign(id);
        assertEq(uint8(syndicates.getSyndicate(id).state), uint8(AgonSyndicateRegistry.State.Settled));
    }
}
