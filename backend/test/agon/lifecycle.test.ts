import assert from "node:assert/strict";
import test from "node:test";
import { reduceListing } from "../../src/agon/core/lifecycle.ts";
test("listed can suspend and suspended can list",()=>{assert.deepEqual(reduceListing("Listed","suspend"),{ok:true,state:"Suspended"});assert.deepEqual(reduceListing("Suspended","reinstate"),{ok:true,state:"Listed"});});
test("delisted is terminal",()=>{for(const command of ["publish","suspend","reinstate"]){assert.equal(reduceListing("Delisted",command).ok,false);}});
