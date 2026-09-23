// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistryV2 } from "../src/AgonServiceRegistryV2.sol";
import { AgonArenaV2 } from "../src/AgonArenaV2.sol";

/// @notice Deploys the version-scoped registry and its linked Arena.
/// @dev Without --broadcast this performs constructor preflight only. Providers
///      must republish current service manifests because V1 listing state is immutable.
contract DeployAgonServiceRegistryV2 is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    function run() external returns (AgonServiceRegistryV2 registry, AgonArenaV2 arena) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");

        address deployer = vm.addr(key);
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", deployer);
        address verifier = vm.envAddress("AGON_VERIFIER_ADDRESS");
        address profileRegistry = vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS");
        address validationRegistry = vm.envAddress("AGON_VALIDATION_REGISTRY_ADDRESS");
        require(admin != address(0), "zero admin");
        require(verifier != address(0), "zero verifier");
        require(profileRegistry.code.length != 0, "profile registry has no code");
        require(validationRegistry.code.length != 0, "validation registry has no code");
        require(AgonProfileRegistry(profileRegistry).hasRole(bytes32(0), admin), "admin is not foundation admin");

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon registry V2 admin", admin);
        console2.log("Agon registry V2 verifier", verifier);
        console2.log("Agon ProfileRegistry", profileRegistry);
        console2.log("Agon ValidationRegistry", validationRegistry);

        vm.startBroadcast(key);
        registry = new AgonServiceRegistryV2(admin, profileRegistry, verifier);
        arena = new AgonArenaV2(admin, profileRegistry, address(registry), validationRegistry, verifier);
        vm.stopBroadcast();

        console2.log("AgonServiceRegistryV2", address(registry));
        console2.log("AgonArenaV2", address(arena));
    }
}
