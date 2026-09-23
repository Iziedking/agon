import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activeAgonArena, activeAgonServiceIndexStartBlock, activeAgonServiceRegistry, loadAgonDeployment, parseAgonDeployment, withActiveAgonContracts } from "../../src/config/deployments.ts";
const complete={chainId:5042002,contracts:{AgonProfileRegistry:"0x1111111111111111111111111111111111111111",AgonServiceRegistry:"0x2222222222222222222222222222222222222222"},external:{IdentityRegistry:{address:"0x8004A818BFB912233c491871b3d84c89A494BD9e",chainId:5042002}}};
test("reports the exact missing Agon contract path",()=>{const input=structuredClone(complete);input.contracts.AgonProfileRegistry="";const result=parseAgonDeployment(input,{registrationMode:true});assert.equal(result.success,false);if(result.success)return;assert.deepEqual(result.issues[0]?.path,["contracts","AgonProfileRegistry"]);});
test("accepts chain-neutral external identity registry metadata",()=>{const result=parseAgonDeployment(complete,{registrationMode:true});assert.equal(result.success,true);if(!result.success)return;assert.equal(result.data.external.IdentityRegistry.chainId,5042002);});
test("refuses registration mode without real receipt addresses",()=>{const input=structuredClone(complete);input.contracts.AgonServiceRegistry="";const result=parseAgonDeployment(input,{registrationMode:true});assert.equal(result.success,false);if(result.success)return;assert.deepEqual(result.issues[0]?.path,["contracts","AgonServiceRegistry"]);});
test("accepts the canonical Arc Testnet deployment receipt",()=>{const input=JSON.parse(readFileSync(new URL("../../../contracts/deployments/agon-arc-testnet.json",import.meta.url),"utf8"));const result=parseAgonDeployment(input,{registrationMode:true});assert.equal(result.success,true);if(!result.success)return;assert.equal(result.data.contracts.AgonProfileRegistry,"0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574");assert.equal(result.data.contracts.AgonServiceRegistry,"0x2144C156B0a4581da2D046C2E41AC41C6C3938CB");assert.equal(result.data.contractInterfaces?.AgonJobEscrow,"legacy-fee-input");});
test("rejects invented job escrow interface labels",()=>{const input={...structuredClone(complete),contractInterfaces:{AgonJobEscrow:"current"}};const result=parseAgonDeployment(input,{registrationMode:true});assert.equal(result.success,false);});
test("loads the canonical receipt and fails closed for a missing file",()=>{const loaded=loadAgonDeployment("../contracts/deployments/agon-arc-testnet.json");assert(loaded.deployment);assert.equal(loaded.error,null);const missing=loadAgonDeployment("../contracts/deployments/does-not-exist.json");assert.equal(missing.deployment,null);assert(missing.error);});
test("accepts an optional V2 escrow beside the legacy escrow",()=>{const input={...structuredClone(complete),contracts:{...complete.contracts,AgonJobEscrow:"0x3333333333333333333333333333333333333333",AgonJobEscrowV2:"0x4444444444444444444444444444444444444444"}};const result=parseAgonDeployment(input,{registrationMode:true});assert.equal(result.success,true);if(!result.success)return;assert.equal(result.data.contracts.AgonJobEscrowV2,"0x4444444444444444444444444444444444444444");});
test("refuses a V2 registry or Arena configured without its linked counterpart", () => {
  for (const contracts of [
    { ...complete.contracts, AgonServiceRegistryV2: "0x5555555555555555555555555555555555555555" },
    { ...complete.contracts, AgonArenaV2: "0x6666666666666666666666666666666666666666" },
  ]) {
    assert.equal(parseAgonDeployment({ ...complete, contracts }, { registrationMode: true }).success, false);
  }
});

test("activates a V2 registry and its Arena without rewriting the canonical V1 receipt", () => {
  const input = {
    ...structuredClone(complete),
    v2DeployBlock: 60000000,
    contracts: {
      ...complete.contracts,
      AgonArena: "0x3333333333333333333333333333333333333333",
      AgonServiceRegistryV2: "0x5555555555555555555555555555555555555555",
      AgonArenaV2: "0x6666666666666666666666666666666666666666",
    },
  };
  const result = parseAgonDeployment(input, { registrationMode: true });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(activeAgonServiceRegistry(result.data), input.contracts.AgonServiceRegistryV2);
  assert.equal(activeAgonArena(result.data), input.contracts.AgonArenaV2);
  assert.equal(activeAgonServiceIndexStartBlock(result.data, 57507744n), 60000000n);
  const runtime = withActiveAgonContracts(result.data);
  assert.equal(runtime.contracts.AgonServiceRegistry, input.contracts.AgonServiceRegistryV2);
  assert.equal(runtime.contracts.AgonArena, input.contracts.AgonArenaV2);
  assert.equal(result.data.contracts.AgonServiceRegistry, complete.contracts.AgonServiceRegistry);
  assert.equal(result.data.contracts.AgonArena, input.contracts.AgonArena);
});

test("V2 activation requires its own deploy block", () => {
  const result = parseAgonDeployment({
    ...complete,
    contracts: {
      ...complete.contracts,
      AgonServiceRegistryV2: "0x5555555555555555555555555555555555555555",
      AgonArenaV2: "0x6666666666666666666666666666666666666666",
    },
  }, { registrationMode: true });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.deepEqual(result.error.issues[0]?.path, ["v2DeployBlock"]);
});
