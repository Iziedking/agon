// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { AgonJobEscrowV2 } from "../src/AgonJobEscrowV2.sol";
import { AgonProfileRegistry } from "../src/AgonProfileRegistry.sol";
import { AgonServiceRegistry } from "../src/AgonServiceRegistry.sol";

/// @notice Deploys the separately versioned escrow with an initial 5% fee.
/// @dev Without --broadcast this performs only constructor preflight. It does
///      not update the canonical deployment receipt.
contract DeployAgonJobEscrowV2 is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    uint256 internal constant DEFAULT_REVIEW_HOURS = 24;
    uint256 internal constant INITIAL_PROTOCOL_FEE_BPS = 500;
    uint256 internal constant MAX_PROTOCOL_FEE_BPS = 1000;
    uint256 internal constant PROTOCOL_FEE_CHANGE_DELAY = 2 days;

    function run() external returns (AgonJobEscrowV2 escrow) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(key != 0, "zero deployer key");
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "wrong deployment chain");

        address deployer = vm.addr(key);
        address admin = vm.envOr("AGON_ADMIN_ADDRESS", deployer);
        address profileRegistry = vm.envAddress("AGON_PROFILE_REGISTRY_ADDRESS");
        address serviceRegistry = vm.envAddress("AGON_SERVICE_REGISTRY_ADDRESS");
        address usdc = vm.envAddress("AGON_USDC_ADDRESS");
        address disputeResolver = vm.envAddress("AGON_DISPUTE_RESOLVER_ADDRESS");
        address treasury = vm.envAddress("AGON_TREASURY_ADDRESS");
        uint256 reviewHours = vm.envOr("AGON_DEFAULT_REVIEW_HOURS", DEFAULT_REVIEW_HOURS);
        uint256 initialFeeBps = vm.envOr("AGON_INITIAL_PROTOCOL_FEE_BPS", INITIAL_PROTOCOL_FEE_BPS);

        require(admin != address(0), "zero admin");
        require(disputeResolver != address(0) && treasury != address(0), "zero protocol address");
        require(reviewHours <= type(uint64).max, "review hours overflow");
        require(initialFeeBps <= MAX_PROTOCOL_FEE_BPS, "initial fee above cap");

        _requireCode(profileRegistry, "profile registry");
        _requireCode(serviceRegistry, "service registry");
        _requireCode(usdc, "USDC");
        require(AgonProfileRegistry(profileRegistry).hasRole(bytes32(0), admin), "admin is not foundation admin");
        require(
            address(AgonServiceRegistry(serviceRegistry).profiles()) == profileRegistry,
            "service registry is not pinned to profile registry"
        );

        console2.log("Arc chain ID", block.chainid);
        console2.log("Agon deployer", deployer);
        console2.log("Agon escrow V2 admin", admin);
        console2.log("Agon ProfileRegistry", profileRegistry);
        console2.log("Agon ServiceRegistry", serviceRegistry);
        console2.log("Agon USDC", usdc);
        console2.log("Agon dispute resolver", disputeResolver);
        console2.log("Agon treasury", treasury);
        console2.log("Agon default review hours", reviewHours);
        console2.log("Agon initial protocol fee bps", initialFeeBps);
        console2.log("Agon maximum protocol fee bps", MAX_PROTOCOL_FEE_BPS);
        console2.log("Agon fee change delay seconds", PROTOCOL_FEE_CHANGE_DELAY);

        vm.startBroadcast(key);
        // forge-lint: disable-next-line(unsafe-typecast) -- bounded by the max checks above.
        escrow = new AgonJobEscrowV2(
            admin, usdc, serviceRegistry, disputeResolver, treasury, uint64(reviewHours), uint16(initialFeeBps)
        );
        vm.stopBroadcast();

        console2.log("AgonJobEscrowV2", address(escrow));
    }

    function _requireCode(address target, string memory label) internal view {
        require(target.code.length != 0, string.concat(label, " has no deployed bytecode"));
    }
}
