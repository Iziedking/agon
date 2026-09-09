import test from "node:test";
import assert from "node:assert/strict";
import { bnbHref, canSignRequest, emptyCategoryCopy, networkTruth, recoveryCopy, requestStatus, validateReportInput, isFinancialAgent, isReportService } from "./journey.ts";
import type { AgentDetail, CommerceIntent, LpHiringReadiness } from "../types.ts";

const intent: CommerceIntent = {
  id: "fixture", chainId: 97, buyerAddress: "0x01", agentId: "2177",
  providerAddress: "0x02", serviceVersion: "fixture", registrationHash: "fixture",
  state: "approve_prepared", amountRaw: "1", amountDisplay: "0.1",
  token: { address: "0x03", decimals: 1, symbol: "TEST" }, quoteHash: "0x04",
  jobId: "1", jobExpiresAt: "2030-01-01T00:00:00Z", quoteExpiresAt: "2029-01-01T00:00:00Z",
  transaction: { chainId: 97, step: "approve", to: "0x03", data: "0x", value: "0", title: "Fixture", warning: "Fixture only" },
  transactionHash: null, confirmations: 0, transactions: [], delivery: null,
  message: "Fixture only", updatedAt: "2026-09-08T00:00:00Z",
};
test("network and resume queries precede the section fragment",()=>{assert.equal(bnbHref(97,"/market/2177?intent=a#hire-agent"),"/market/2177?intent=a&network=bnb-testnet#hire-agent");assert.equal(bnbHref(56,"/market?network=bnb-testnet#results"),"/market?network=bnb-mainnet#results");});
test("signing rejects stale network and absent transaction",()=>{assert.equal(canSignRequest(intent,97,0),true);assert.equal(canSignRequest(intent,56,0),false);assert.equal(canSignRequest({...intent,transaction:null},97,0),false);assert.equal(canSignRequest({...intent,transaction:{...intent.transaction!,chainId:56} as never},97,0),false);});
for(const state of ["expired","reverted","needs_attention","funded","approve_confirming"] as const)test(`signing rejects ${state}`,()=>assert.equal(canSignRequest({...intent,state},97,0),false));
test("signing rejects expired or malformed expiry",()=>{assert.equal(canSignRequest(intent,97,Date.parse("2031-01-01")),false);assert.equal(canSignRequest({...intent,jobExpiresAt:"invalid"},97,0),false);});
test("recovery does not promise no funds moved or an automatic refund",()=>{assert.match(recoveryCopy({...intent,state:"expired"}),/does not revoke token approvals or prove a refund/);assert.doesNotMatch(recoveryCopy({...intent,state:"expired"}),/No funds were moved/);});
test("failed delivery is not reported as healthy progress",()=>{assert.equal(requestStatus({...intent,state:"funded",delivery:{status:"failed"} as never}),"Delivery needs attention");assert.equal(requestStatus({...intent,state:"funded",delivery:{status:"submitted"} as never}),"Report submitted");});
test("all report inputs are validated before advancing",()=>{assert.equal(validateReportInput("37235","10","100"),null);for(const input of [["","10","100"],["0","10","100"],["123","1.5","100"],["123","10",""],["123","10","-1"]])assert.ok(validateReportInput(...input as [string,string,string]));});
test("unclassified identities are not financial service recommendations",()=>{assert.equal(isFinancialAgent({category:null,outcomeMatches:[]} as never),false);assert.equal(isFinancialAgent({category:"health-factor",outcomeMatches:[]} as never),true);});
test("paid report UI is bound to the matching network and registration",()=>{const agent={chainId:97,id:"2177",metadataStatus:"available",registrationMatches:true,services:[{name:"ERC-8183"}]} as AgentDetail;const readiness={chainId:97,agentId:"2177"} as LpHiringReadiness;assert.equal(isReportService(agent,readiness),true);assert.equal(isReportService({...agent,chainId:56},readiness),false);assert.equal(isReportService({...agent,registrationMatches:false},readiness),false);assert.equal(isReportService(agent,{...readiness,agentId:"99"}),false);assert.equal(isReportService(agent,null),false);});
test("only chain 97 is described as activatable",()=>{const testnet=networkTruth(97);const mainnet=networkTruth(56);assert.equal(testnet.activation,"available");assert.equal(testnet.chainLabel,"BSC Testnet");assert.equal(testnet.switchTo,null);assert.equal(mainnet.activation,"discovery_only");assert.equal(mainnet.chainLabel,"BSC Mainnet");assert.equal(mainnet.switchTo,97);assert.match(testnet.headline,/chain 97/);assert.match(mainnet.headline,/chain 56/);});
test("mainnet truth never claims payment or delivery on chain 56",()=>{const mainnet=networkTruth(56);assert.doesNotMatch(mainnet.detail,/paid activation settles/i);assert.match(mainnet.detail,/run on BSC Testnet/);});
test("an empty mainnet category explains itself and offers no mainnet activation",()=>{const mainnet=emptyCategoryCopy(56,"Grid trading");assert.match(mainnet.heading,/BSC Mainnet/);assert.match(mainnet.detail,/chain 56/);assert.match(mainnet.detail,/does not show Testnet agents under a Mainnet label/);assert.equal(mainnet.switchTo,97);});
test("an empty testnet category stays a plain no-result answer",()=>{const testnet=emptyCategoryCopy(97,"Grid trading");assert.equal(testnet.switchTo,null);assert.match(testnet.detail,/No payment or task was started/);assert.match(testnet.detail,/grid trading/);});
