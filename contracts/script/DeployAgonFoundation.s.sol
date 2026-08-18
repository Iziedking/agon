// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";

contract DeployAgonFoundation is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;

    struct Deployed {
        AgonProfileRegistry profileRegistry;
        AgonServiceRegistry serviceRegistry;
    }

    function run() external returns (Deployed memory d) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");

        address deployer = vm.addr(key);
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", deployer);
        address identity = vm.envAddress("IDENTITY_REGISTRY_ADDRESS");
        require(admin != address(0) && identity != address(0), "zero foundation address");
        require(identity.code.length != 0, "identity registry has no code");

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon admin", admin);
        console2.log("ERC-8004 IdentityRegistry", identity);

        vm.startBroadcast(key);
        d.profileRegistry = new AgonProfileRegistry(admin, identity);
        d.serviceRegistry = new AgonServiceRegistry(admin, address(d.profileRegistry));
        vm.stopBroadcast();

        console2.log("AgonProfileRegistry", address(d.profileRegistry));
        console2.log("AgonServiceRegistry", address(d.serviceRegistry));
    }
}
