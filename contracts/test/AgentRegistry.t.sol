// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";

import { AgentRegistry } from "../src/AgentRegistry.sol";
import { ContestType } from "../src/types/ArcRunTypes.sol";

import { MockUSDC } from "./mocks/MockUSDC.sol";
import { MockIdentityRegistry } from "./mocks/MockIdentityRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry internal registry;
    MockUSDC internal usdc;
    MockIdentityRegistry internal idRegistry;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal engine = makeAddr("engine");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdc = new MockUSDC();
        idRegistry = new MockIdentityRegistry();
        vm.startPrank(admin);
        registry = new AgentRegistry(admin, address(idRegistry), address(usdc), treasury);
        registry.grantRole(registry.CONTEST_ENGINE_ROLE(), engine);
        vm.stopPrank();
    }

    function test_createAgent_mintsIdentityHeldByContract() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        assertEq(agentId, 1);
        assertEq(registry.ownerOfAgent(agentId), alice, "in-game owner is the player");

        AgentRegistry.Agent memory a = registry.getAgent(agentId);
        // Variant A: the registry contract holds the ERC-8004 NFT.
        assertEq(idRegistry.ownerOf(a.erc8004TokenId), address(registry));
    }

    function test_createAgent_revertsOnEmptyMetadata() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.EmptyMetadata.selector);
        registry.createAgent("");
    }

    function test_createAgent_revertsOverMaxPerOwner() public {
        vm.prank(admin);
        registry.setMaxAgentsPerOwner(1);

        vm.startPrank(alice);
        registry.createAgent("ipfs://a");
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.TooManyAgents.selector, uint16(1)));
        registry.createAgent("ipfs://b");
        vm.stopPrank();
    }

    function test_upgradeAgent_pullsUsdcToTreasury() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        uint256 price = registry.upgradePrice(ContestType.SCOUT, 0); // 10 USDC
        usdc.mint(alice, price);
        vm.startPrank(alice);
        usdc.approve(address(registry), price);
        registry.upgradeAgent(agentId, ContestType.SCOUT, 1);
        vm.stopPrank();

        assertEq(registry.getTier(agentId, ContestType.SCOUT), 1);
        assertEq(usdc.balanceOf(treasury), price);
    }

    function test_upgradeAgent_revertsNonSequential() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.MustUpgradeSequentially.selector, uint16(0), uint16(2)));
        registry.upgradeAgent(agentId, ContestType.SCOUT, 2);
    }

    function test_upgradeAgent_revertsAboveMaxTier() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.InvalidTier.selector, uint16(3)));
        registry.upgradeAgent(agentId, ContestType.SCOUT, 3);
    }

    function test_upgradeAgent_revertsNonOwner() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotAgentOwner.selector);
        registry.upgradeAgent(agentId, ContestType.SCOUT, 1);
    }

    function test_applyReputationChange_onlyEngine() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(alice);
        vm.expectRevert();
        registry.applyReputationChange(agentId, 50e6);
    }

    function test_reputation_decaysOverTime() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        vm.prank(engine);
        registry.applyReputationChange(agentId, 50e6);
        assertEq(registry.getEffectiveReputation(agentId), 50e6, "no decay same day");

        // 0.4% per day: after one day 50e6 * 996/1000 = 49.8e6
        vm.warp(block.timestamp + 1 days);
        assertEq(registry.getEffectiveReputation(agentId), 49_800_000);

        // negative delta floors at zero
        vm.prank(engine);
        registry.applyReputationChange(agentId, -100e6);
        assertEq(registry.getEffectiveReputation(agentId), 0);
    }

    function test_agentsOf_tracksOwnership() public {
        vm.startPrank(alice);
        registry.createAgent("ipfs://a");
        registry.createAgent("ipfs://b");
        vm.stopPrank();
        assertEq(registry.agentsOf(alice).length, 2);
    }

    function test_nextAgentId_increments() public {
        assertEq(registry.nextAgentId(), 1);
        vm.prank(alice);
        registry.createAgent("ipfs://a");
        assertEq(registry.nextAgentId(), 2);
    }

    function test_views_returnZeroForUnknownAgent() public view {
        assertEq(registry.getEffectiveReputation(999), 0);
        assertEq(registry.getTier(999, ContestType.SCOUT), 0);
        assertEq(registry.ownerOfAgent(999), address(0));
    }

    function test_reputation_decayCapsAt365Days() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");
        vm.prank(engine);
        registry.applyReputationChange(agentId, 50e6);

        vm.warp(block.timestamp + 365 days);
        uint128 at365 = registry.getEffectiveReputation(agentId);

        vm.warp(block.timestamp + 35 days); // 400 days total, beyond the cap
        uint128 at400 = registry.getEffectiveReputation(agentId);

        assertEq(at400, at365, "decay saturates at the 365-day cap");
        assertLt(at365, 50e6);
        assertGt(at365, 0);
    }

    function test_adminSetters() public {
        address newTreasury = makeAddr("newTreasury");
        vm.startPrank(admin);
        registry.setTreasury(newTreasury);
        registry.setMaxAgentsPerOwner(3);
        registry.setUpgradePrice(ContestType.SCOUT, 0, 99e6);
        vm.stopPrank();

        assertEq(registry.treasury(), newTreasury);
        assertEq(registry.maxAgentsPerOwner(), 3);
        assertEq(registry.upgradePrice(ContestType.SCOUT, 0), 99e6);
    }

    function test_setUpgradePrice_revertsAtOrAboveMaxTier() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AgentRegistry.InvalidTier.selector, uint16(2)));
        registry.setUpgradePrice(ContestType.SCOUT, 2, 1e6);
    }

    function test_setters_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setTreasury(alice);
    }

    function test_upgradeAgent_revertsOnUnknownAgent() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.AgentDoesNotExist.selector);
        registry.upgradeAgent(999, ContestType.SCOUT, 1);
    }

    function test_secondTierUpgrade() public {
        vm.prank(alice);
        uint256 agentId = registry.createAgent("ipfs://a");

        uint256 p0 = registry.upgradePrice(ContestType.ANALYST, 0);
        uint256 p1 = registry.upgradePrice(ContestType.ANALYST, 1);
        usdc.mint(alice, p0 + p1);

        vm.startPrank(alice);
        usdc.approve(address(registry), p0 + p1);
        registry.upgradeAgent(agentId, ContestType.ANALYST, 1);
        registry.upgradeAgent(agentId, ContestType.ANALYST, 2);
        vm.stopPrank();

        assertEq(registry.getTier(agentId, ContestType.ANALYST), 2);
        assertEq(usdc.balanceOf(treasury), p0 + p1);
    }
}
