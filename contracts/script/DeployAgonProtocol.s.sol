// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { AgonArena } from "../src/AgonArena.sol";
import { AgonJobEscrow } from "../src/AgonJobEscrow.sol";
import { AgonPrizeVault } from "../src/AgonPrizeVault.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";
import { AgonSyndicateRegistry } from "../src/AgonSyndicateRegistry.sol";

/// @notice Deploys the post-foundation Agon contracts against an existing
///         receipt-verified ProfileRegistry and ServiceRegistry.
/// @dev    Without --broadcast, this is a read-only constructor and address
///         preflight. It never writes the canonical deployment receipt.
contract DeployAgonProtocol is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant DEFAULT_REVIEW_HOURS = 24;

    struct Deployed {
        AgonJobEscrow jobEscrow;
        AgonArena arena;
        AgonSyndicateRegistry syndicateRegistry;
        AgonPrizeVault prizeVault;
    }

    function run() external returns (Deployed memory d) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");

        address deployer = vm.addr(key);
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", deployer);
        address profileRegistry = vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS");
        address serviceRegistry = vm.envAddress("AGON_SERVICE_REGISTRY_ADDRESS");
        address usdc = vm.envAddress("AGON_USDC_ADDRESS");
        address validationRegistry = vm.envAddress("AGON_VALIDATION_REGISTRY_ADDRESS");
        address disputeResolver = vm.envAddress("AGON_DISPUTE_RESOLVER_ADDRESS");
        address treasury = vm.envAddress("AGON_TREASURY_ADDRESS");
        uint256 reviewHours = vm.envOr("AGON_DEFAULT_REVIEW_HOURS", DEFAULT_REVIEW_HOURS);

        require(admin != address(0), "zero admin");
        require(disputeResolver != address(0) && treasury != address(0), "zero protocol address");
        require(reviewHours <= type(uint64).max, "review hours overflow");

        _requireCode(profileRegistry, "profile registry");
        _requireCode(serviceRegistry, "service registry");
        _requireCode(usdc, "USDC");
        _requireCode(validationRegistry, "validation registry");
        require(AgonProfileRegistry(profileRegistry).hasRole(bytes32(0), admin), "admin is not foundation admin");
        require(
            address(AgonServiceRegistry(serviceRegistry).profiles()) == profileRegistry,
            "service registry is not pinned to profile registry"
        );

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon admin", admin);
        console2.log("Agon ProfileRegistry", profileRegistry);
        console2.log("Agon ServiceRegistry", serviceRegistry);
        console2.log("Agon USDC", usdc);
        console2.log("Agon ValidationRegistry", validationRegistry);
        console2.log("Agon dispute resolver", disputeResolver);
        console2.log("Agon treasury", treasury);
        console2.log("Agon default review hours", reviewHours);

        vm.startBroadcast(key);
        // forge-lint: disable-next-line(unsafe-typecast) -- bounded by the max check above.
        d.jobEscrow = new AgonJobEscrow(admin, usdc, serviceRegistry, disputeResolver, treasury, uint64(reviewHours));
        d.arena = new AgonArena(admin, profileRegistry, serviceRegistry, validationRegistry);
        d.syndicateRegistry = new AgonSyndicateRegistry(admin, profileRegistry);
        d.prizeVault = new AgonPrizeVault(admin, usdc, treasury);
        vm.stopBroadcast();

        console2.log("AgonJobEscrow", address(d.jobEscrow));
        console2.log("AgonArena", address(d.arena));
        console2.log("AgonSyndicateRegistry", address(d.syndicateRegistry));
        console2.log("AgonPrizeVault", address(d.prizeVault));
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length != 0, string.concat(label, " has no deployed bytecode"));
    }
}
