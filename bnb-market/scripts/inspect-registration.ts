import { agentDetail, registration } from "../src/shared/server/catalog.ts";
const agent = await agentDetail(97, "2114");
const metadata = await registration(agent.uri);
console.log(JSON.stringify({ keys: Object.keys(metadata), category: metadata.category, categories: metadata.categories, skills: metadata.skills, agon: metadata.agon, agentType: metadata.agentType }, null, 2));
