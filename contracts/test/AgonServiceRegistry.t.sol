// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { Test } from "forge-std/Test.sol";
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";

contract AgonServiceIdentity is ERC721 {
    constructor() ERC721("External Agent", "AGENT") { }

    function mint(address owner, uint256 id) external {
        _mint(owner, id);
    }
}

contract AgonServiceRegistryTest is Test {
    AgonServiceIdentity identity;
    AgonProfileRegistry profiles;
    AgonServiceRegistry services;
    address admin = makeAddr("admin");
    address provider = makeAddr("provider");
    address stranger = makeAddr("stranger");
    bytes32 key = keccak256("secure-review");
    bytes32 manifest = keccak256("canonical-manifest");

    function setUp() public {
        identity = new AgonServiceIdentity();
        profiles = new AgonProfileRegistry(admin, address(identity));
        services = new AgonServiceRegistry(admin, address(profiles));
        identity.mint(provider, 42);
        vm.prank(provider);
        profiles.bindProfile(42, "ipfs://profile");
    }

    function _publish(AgonServiceRegistry.PaymentRail rail) internal returns (uint256) {
        vm.prank(provider);
        return services.publish(42, key, manifest, "ipfs://manifest-v1", 1, rail);
    }

    function test_publish_allowsCurrentIdentityOwner() public {
        uint256 id = _publish(AgonServiceRegistry.PaymentRail.X402);
        assertEq(id, 1);
        assertEq(uint8(services.getListing(1).verification), uint8(AgonServiceRegistry.Verification.Unverified));
    }

    function test_publish_emitsCompleteListingAnchor() public {
        vm.expectEmit(true, true, true, true, address(services));
        emit AgonServiceRegistry.ListingPublished(
            1,
            42,
            key,
            manifest,
            "ipfs://manifest-v1",
            1,
            AgonServiceRegistry.PaymentRail.X402,
            1,
            provider,
            AgonServiceRegistry.ListingStatus.Listed,
            AgonServiceRegistry.Verification.Unverified
        );
        _publish(AgonServiceRegistry.PaymentRail.X402);
    }

    function test_publish_refusesNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(AgonServiceRegistry.NotIdentityOwner.selector);
        services.publish(42, key, manifest, "ipfs://manifest-v1", 1, AgonServiceRegistry.PaymentRail.X402);
    }

    function test_serviceKey_isUniquePerAgent() public {
        _publish(AgonServiceRegistry.PaymentRail.X402);
        vm.prank(provider);
        vm.expectRevert(AgonServiceRegistry.ServiceKeyAlreadyPublished.selector);
        services.publish(42, key, manifest, "ipfs://other", 1, AgonServiceRegistry.PaymentRail.X402);
    }

    function test_versions_areImmutableAndSequential() public {
        uint256 id = _publish(AgonServiceRegistry.PaymentRail.X402);
        bytes32 versionHash = keccak256("v2");
        vm.expectEmit(true, true, true, true, address(services));
        emit AgonServiceRegistry.ListingVersionPublished(
            id, 2, versionHash, "ipfs://manifest-v2", AgonServiceRegistry.PaymentRail.X402, provider
        );
        vm.prank(provider);
        services.publishVersion(id, versionHash, "ipfs://manifest-v2", AgonServiceRegistry.PaymentRail.X402);
        assertEq(services.getVersion(id, 1).manifestHash, manifest);
        assertEq(services.getVersion(id, 2).manifestHash, versionHash);
        assertEq(services.getListing(id).version, 2);
    }

    function test_statusChanges_requireOwner() public {
        uint256 id = _publish(AgonServiceRegistry.PaymentRail.X402);
        vm.expectEmit(true, true, false, true, address(services));
        emit AgonServiceRegistry.ListingStatusChanged(id, provider, AgonServiceRegistry.ListingStatus.Suspended);
        vm.prank(provider);
        services.setStatus(id, AgonServiceRegistry.ListingStatus.Suspended);
        assertEq(uint8(services.getListing(id).status), uint8(AgonServiceRegistry.ListingStatus.Suspended));
        vm.prank(stranger);
        vm.expectRevert(AgonServiceRegistry.NotIdentityOwner.selector);
        services.setStatus(id, AgonServiceRegistry.ListingStatus.Delisted);
    }

    function test_publish_validatesCategoryHashAndUri() public {
        vm.startPrank(provider);
        vm.expectRevert(AgonServiceRegistry.InvalidCategory.selector);
        services.publish(42, key, manifest, "ipfs://manifest", 0, AgonServiceRegistry.PaymentRail.X402);
        vm.expectRevert(AgonServiceRegistry.InvalidServiceKey.selector);
        services.publish(42, bytes32(0), manifest, "ipfs://manifest", 1, AgonServiceRegistry.PaymentRail.X402);
        vm.expectRevert(AgonServiceRegistry.InvalidManifest.selector);
        services.publish(42, key, bytes32(0), "ipfs://manifest", 1, AgonServiceRegistry.PaymentRail.X402);
        vm.expectRevert(AgonServiceRegistry.InvalidManifest.selector);
        services.publish(42, key, manifest, "", 1, AgonServiceRegistry.PaymentRail.X402);
        vm.stopPrank();
    }

    function test_unverifiedEscrow_isNotEligible() public {
        uint256 id = _publish(AgonServiceRegistry.PaymentRail.Escrow);
        assertFalse(services.escrowEligible(id));
    }

    function test_onlyVerifier_canSetVerification() public {
        uint256 id = _publish(AgonServiceRegistry.PaymentRail.Escrow);
        vm.prank(stranger);
        vm.expectRevert();
        services.setVerification(id, AgonServiceRegistry.Verification.Verified);
        vm.startPrank(admin);
        services.grantRole(services.VERIFIER_ROLE(), admin);
        vm.expectEmit(true, true, false, true, address(services));
        emit AgonServiceRegistry.ListingVerificationChanged(id, admin, AgonServiceRegistry.Verification.Verified);
        services.setVerification(id, AgonServiceRegistry.Verification.Verified);
        vm.stopPrank();
        assertTrue(services.escrowEligible(id));
    }
}
