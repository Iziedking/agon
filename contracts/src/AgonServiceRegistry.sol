// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { AgonProfileRegistry } from "./AgonProfileRegistry.sol";

contract AgonServiceRegistry is AccessControl {
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    enum ListingStatus {
        Listed,
        Suspended,
        Delisted
    }
    enum Verification {
        Unverified,
        Pending,
        Verified,
        Expired,
        Suspended,
        Revoked
    }
    enum PaymentRail {
        X402,
        Escrow
    }

    struct Listing {
        uint256 listingId;
        uint256 agentId;
        bytes32 serviceKey;
        bytes32 manifestHash;
        string manifestURI;
        uint256 category;
        PaymentRail paymentRail;
        uint256 version;
        address providerSnapshot;
        ListingStatus status;
        Verification verification;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Version {
        uint256 version;
        bytes32 manifestHash;
        string manifestURI;
        PaymentRail paymentRail;
        address providerSnapshot;
        uint64 createdAt;
    }
    AgonProfileRegistry public immutable profiles;
    uint256 private nextListingId = 1;
    mapping(uint256 => Listing) private listings;
    mapping(uint256 => mapping(uint256 => Version)) private versions;
    mapping(uint256 => mapping(bytes32 => bool)) private usedKeys;
    error NotIdentityOwner();
    error ServiceKeyAlreadyPublished();
    error InvalidCategory();
    error InvalidServiceKey();
    error InvalidManifest();
    error ListingMissing();
    error InvalidVersion();
    event ListingPublished(
        uint256 indexed listingId,
        uint256 indexed agentId,
        bytes32 indexed serviceKey,
        bytes32 manifestHash,
        string manifestURI,
        uint256 category,
        PaymentRail paymentRail,
        uint256 version,
        address providerSnapshot,
        ListingStatus status,
        Verification verification
    );
    event ListingVersionPublished(
        uint256 indexed listingId,
        uint256 indexed version,
        bytes32 indexed manifestHash,
        string manifestURI,
        PaymentRail paymentRail,
        address providerSnapshot
    );
    event ListingStatusChanged(uint256 indexed listingId, address indexed providerSnapshot, ListingStatus status);
    event ListingVerificationChanged(uint256 indexed listingId, address indexed verifier, Verification verification);

    constructor(address admin, address profileRegistry) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        profiles = AgonProfileRegistry(profileRegistry);
    }
    modifier ownerOfListing(uint256 id) {
        Listing storage l = listings[id];
        if (l.listingId == 0) revert ListingMissing();
        if (profiles.currentOwner(l.agentId) != msg.sender) revert NotIdentityOwner();
        _;
    }

    function publish(
        uint256 agentId,
        bytes32 serviceKey,
        bytes32 manifestHash,
        string calldata uri,
        uint256 category,
        PaymentRail rail
    ) external returns (uint256 id) {
        if (profiles.currentOwner(agentId) != msg.sender) revert NotIdentityOwner();
        if (serviceKey == bytes32(0)) revert InvalidServiceKey();
        if (manifestHash == bytes32(0) || bytes(uri).length == 0) revert InvalidManifest();
        if (category == 0) revert InvalidCategory();
        if (usedKeys[agentId][serviceKey]) revert ServiceKeyAlreadyPublished();
        id = nextListingId++;
        usedKeys[agentId][serviceKey] = true;
        listings[id] = Listing(
            id,
            agentId,
            serviceKey,
            manifestHash,
            uri,
            category,
            rail,
            1,
            msg.sender,
            ListingStatus.Listed,
            Verification.Unverified,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        versions[id][1] = Version(1, manifestHash, uri, rail, msg.sender, uint64(block.timestamp));
        emit ListingPublished(
            id,
            agentId,
            serviceKey,
            manifestHash,
            uri,
            category,
            rail,
            1,
            msg.sender,
            ListingStatus.Listed,
            Verification.Unverified
        );
    }

    function publishVersion(uint256 id, bytes32 hash, string calldata uri, PaymentRail rail)
        external
        ownerOfListing(id)
    {
        if (hash == bytes32(0) || bytes(uri).length == 0) revert InvalidManifest();
        Listing storage l = listings[id];
        uint256 v = l.version + 1;
        l.version = v;
        l.manifestHash = hash;
        l.manifestURI = uri;
        l.paymentRail = rail;
        l.providerSnapshot = msg.sender;
        l.updatedAt = uint64(block.timestamp);
        versions[id][v] = Version(v, hash, uri, rail, msg.sender, uint64(block.timestamp));
        emit ListingVersionPublished(id, v, hash, uri, rail, msg.sender);
    }

    function setStatus(uint256 id, ListingStatus status) external ownerOfListing(id) {
        listings[id].status = status;
        listings[id].updatedAt = uint64(block.timestamp);
        emit ListingStatusChanged(id, msg.sender, status);
    }

    function setVerification(uint256 id, Verification v) external onlyRole(VERIFIER_ROLE) {
        if (listings[id].listingId == 0) revert ListingMissing();
        listings[id].verification = v;
        listings[id].updatedAt = uint64(block.timestamp);
        emit ListingVerificationChanged(id, msg.sender, v);
    }

    function escrowEligible(uint256 id) public view returns (bool) {
        Listing storage l = listings[id];
        return l.listingId != 0 && l.paymentRail == PaymentRail.Escrow && l.verification == Verification.Verified
            && l.status == ListingStatus.Listed;
    }

    function getListing(uint256 id) external view returns (Listing memory) {
        if (listings[id].listingId == 0) revert ListingMissing();
        return listings[id];
    }

    function getVersion(uint256 id, uint256 v) external view returns (Version memory) {
        if (listings[id].listingId == 0 || versions[id][v].version == 0) revert InvalidVersion();
        return versions[id][v];
    }
}
