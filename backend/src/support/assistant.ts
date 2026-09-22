import { config } from "../config/index.js";
import { callModel, llmConfigured } from "../runners/llm/client.js";
import { query } from "../db/pool.js";
import { randomUUID } from "node:crypto";
import { needsHumanSupport, redactSupportMessage } from "./core.js";

export type SupportAssistantResult = {
  reply: string;
  escalate: boolean;
  mode: "model" | "guide" | "handoff";
};

function guideFor(message: string): SupportAssistantResult {
  if (/\b(logo|icon|image|card)\b/i.test(message)) {
    return { reply: "Open the service details and confirm the current listing version contains a public HTTPS icon URL. If the details page has the icon but the market card does not, send the service reference here and the team will check the market index.", escalate: false, mode: "guide" };
  }
  if (/\b(list|listing|publish|service)\b/i.test(message)) {
    return { reply: "Check that the service name, plain-language description, price, HTTPS endpoint, category, and square icon are present before publishing. Keep this ticket open if the listing remains unavailable after those checks.", escalate: false, mode: "guide" };
  }
  if (/\b(wallet|connect|sign in|login)\b/i.test(message)) {
    return { reply: "Reconnect the intended wallet, confirm Arc Testnet is selected, then refresh the page once. Never send a private key, seed phrase, password, or admin token in this chat.", escalate: false, mode: "guide" };
  }
  if (/\b(payment|pay|price|hire)\b/i.test(message)) {
    return { reply: "Open the service terms, review the exact price and delivery promise, then approve the payment from the wallet you intend to use. If you were charged without a completed result, keep this ticket open for the team.", escalate: false, mode: "guide" };
  }
  if (/\b(test|verify|verification|arena|playground)\b/i.test(message)) {
    return { reply: "Open the exact service version, run its matching playground check, and wait for Arena finality. If the progress does not change after a fresh status check, share the service reference and the team can inspect the recorded state.", escalate: false, mode: "guide" };
  }
  return { reply: "I can help with listing, wallet connection, service testing, hiring, and payment questions. Describe what you expected, what happened, and the service reference if one is available.", escalate: false, mode: "guide" };
}

export async function answerSupportMessage(message: string, recentMessages: string[] = [], ticketId?: string): Promise<SupportAssistantResult> {
  if (needsHumanSupport(message)) {
    return { reply: "I have placed this conversation in the team queue. A support teammate can continue here with the full history. Do not share passwords, private keys, seed phrases, or admin tokens.", escalate: true, mode: "handoff" };
  }
  if (!config.support.aiEnabled || !llmConfigured() || !ticketId || config.support.aiDailyUsd <= 0) return guideFor(message);

  const spend = await query<{ spent: string }>(
    "select coalesce(sum(cost_usd), 0)::text as spent from agon_support_ai_usage where created_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')",
  );
  if (Number(spend.rows[0]?.spent ?? "0") >= config.support.aiDailyUsd) return guideFor(message);

  const safeMessage = redactSupportMessage(message);
  const safeHistory = recentMessages.slice(-8).map(redactSupportMessage).join("\n");
  try {
    const result = await callModel({
      model: config.support.aiModel,
      systemPrompt: [
        "You are AGON support triage. Give one concise, practical answer using only public product guidance.",
        "Never request or repeat passwords, private keys, seed phrases, admin tokens, wallet signatures, or payment authorization.",
        "Never claim to inspect an account, transaction, service, or chain state. Never change verification or payment state.",
        "If a human must inspect state, end the response with [ESCALATE]. Otherwise end with [SELF_SERVE].",
      ].join(" "),
      userPrompt: `Recent conversation:\n${safeHistory || "none"}\n\nLatest question:\n${safeMessage}`,
      maxTokens: 260,
      temperature: 0.1,
    });
    const escalate = result.text.includes("[ESCALATE]");
    const reply = result.text.replace(/\[(?:ESCALATE|SELF_SERVE)\]/g, "").trim();
    if (!reply) return guideFor(message);
    await query(
      `insert into agon_support_ai_usage (call_id, ticket_id, model, input_tokens, output_tokens, cost_usd)
       values ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), ticketId, result.model, result.inputTokens, result.outputTokens, result.costUsd],
    );
    return { reply, escalate, mode: "model" };
  } catch {
    return guideFor(message);
  }
}
