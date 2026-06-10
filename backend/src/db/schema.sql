-- ArcRun denormalized read model. Big integers (uint256) are stored as numeric
-- to keep full precision; the indexer writes them as decimal strings.

create table if not exists indexer_state (
  id          int primary key default 1,
  last_block  bigint not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists operators (
  address              text primary key,
  x_handle             text,
  telegram_id          text,
  telegram_username    text,
  discord_id           text,
  discord_username     text,
  current_syndicate_id bigint,
  reputation           numeric not null default 0,
  cycles               numeric not null default 0,
  created_at           timestamptz not null default now()
);
-- Add cycles to operators tables created before this column existed.
alter table operators add column if not exists cycles numeric not null default 0;
-- Telegram and Discord social linking columns, idempotent for live deployments.
alter table operators add column if not exists telegram_id text;
alter table operators add column if not exists telegram_username text;
alter table operators add column if not exists discord_id text;
alter table operators add column if not exists discord_username text;
-- Email and Circle Dev-Controlled wallet linkage. An operator row exists for
-- both SIWE-only users (email/circle null) and email-login users (email set,
-- circle_wallet_id set). When circle_wallet_id is non-null the backend signs
-- writes on the operator's behalf through Circle. Email is unique so the same
-- mailbox cannot register two wallets.
alter table operators add column if not exists email text;
alter table operators add column if not exists circle_wallet_id text;
create unique index if not exists operators_email_idx on operators(email) where email is not null;
create unique index if not exists operators_circle_wallet_idx on operators(circle_wallet_id) where circle_wallet_id is not null;

-- Per-call audit trail for LLM runner calls. Lets the demo prove that an
-- agent's answer came from a real model call and not a synthetic ticker:
-- show the puzzle text, the agent's response, the verdict, and the tokens
-- consumed. (contest_id, agent_id, round_idx, puzzle_idx) uniquely keys a
-- single solve attempt; primary key is the autoincrement id to make
-- inserts simple.
create table if not exists llm_runs (
  id            bigserial primary key,
  contest_id    bigint not null,
  agent_id      bigint not null,
  operator      text   not null,
  round_idx     int    not null default 0,
  puzzle_idx    int    not null default 0,
  kind          text   not null, -- "solver" | "analyst" | "scout"
  model         text   not null,
  prompt        text   not null,
  response      text   not null,
  expected      text,
  -- The agent's final answer, extracted from `response` by the judge. This
  -- is what the live "REAL SOLVES" cell displays so the audience sees just
  -- the answer ("C", "9375", "transfer") instead of the full reasoning.
  -- Hover/tooltip still surfaces the full response text.
  answer        text,
  verdict       text   not null, -- "correct" | "wrong" | "skipped" | "error"
  latency_ms    int    not null default 0,
  input_tokens  int    not null default 0,
  output_tokens int    not null default 0,
  cost_usd      numeric(12, 6) not null default 0,
  created_at    timestamptz not null default now()
);
-- Backfill for existing deployments where llm_runs was created without the
-- answer column. Safe to run repeatedly.
alter table llm_runs add column if not exists answer text;
create index if not exists llm_runs_contest_idx on llm_runs(contest_id, agent_id);
create index if not exists llm_runs_created_idx on llm_runs(created_at desc);
-- One audit row per (contest, agent, kind, round, puzzle). Without this the
-- runner duplicates rows every preview pass during the live window, and the
-- LLM gets called per pass too, so the demo paid for the same solve 40
-- times. Insert path uses ON CONFLICT DO NOTHING to make re-runs idempotent.
-- Dedupe any historical bloat first so the unique index can build.
delete from llm_runs
where id in (
  select id from (
    select id, row_number() over (
      partition by contest_id, agent_id, kind, round_idx, puzzle_idx
      order by created_at, id
    ) as rn
    from llm_runs
  ) ranked
  where rn > 1
);
create unique index if not exists llm_runs_unique_idx
  on llm_runs(contest_id, agent_id, kind, round_idx, puzzle_idx);

-- WebAuthn passkey credentials. One row per registered authenticator. An email
-- can have multiple credentials over time (extra devices), but the demo only
-- ever uses one per email. `credential_id` is base64url-encoded as it comes
-- from the authenticator; `public_key` is the raw CBOR-encoded public key
-- bytes the SimpleWebAuthn library returns. `operator_address` is the email
-- user's resolved wallet address (foreign-key-ish to operators.address).
create table if not exists webauthn_credentials (
  credential_id    text primary key,
  operator_address text not null,
  public_key       bytea not null,
  counter          bigint not null default 0,
  transports       text[],
  device_type      text,
  backed_up        boolean,
  created_at       timestamptz not null default now()
);
create index if not exists webauthn_credentials_op_idx on webauthn_credentials(operator_address);

create table if not exists agents (
  id               bigint primary key,
  owner            text not null,
  erc8004_token_id numeric,
  scout_tier       int not null default 0,
  analyst_tier     int not null default 0,
  solver_tier      int not null default 0,
  reputation       numeric not null default 0,
  nickname         text,
  created_at       timestamptz not null default now()
);
create index if not exists agents_owner_idx on agents(owner);
-- Backfill columns for installs that pre-date them; no-op when already present.
alter table agents add column if not exists nickname text;
-- Custom skin: base64 data URL (image/png|jpeg|webp|gif), capped 256KB on the
-- server. Null means "use the mascot variant fallback".
alter table agents add column if not exists skin text;

-- Phase 2 scoring mode: pnl_mtm (default), pnl_realized, or volume.
-- Set by the creator at contest/challenge open time; the runner reads it
-- at settlement to dispatch the right payout curve. NULL = default
-- (pnl_mtm). Stored off-chain because contracts don't see it.
-- See docs/brandkit/13-prediction-windows-design.md.
create table if not exists contests (
  id              bigint primary key,
  sponsor         text,
  contest_type    int,
  protocol_target text,
  metric          text,
  prize_pool      numeric,
  status          text not null default 'open',
  final_root      text,
  paid_out        numeric,
  platform_fee    numeric,
  created_block   bigint,
  created_at      timestamptz not null default now()
);

create table if not exists entries (
  contest_id     bigint not null,
  agent_id       bigint not null,
  operator       text not null,
  syndicate_id   bigint,
  claimed        boolean not null default false,
  claimed_amount numeric,
  created_at     timestamptz not null default now(),
  primary key (contest_id, agent_id)
);
create index if not exists entries_operator_idx on entries(operator);

-- Idempotent column add so existing DBs pick up scoring_mode without a
-- manual migration. Default null = treat as pnl_mtm at scoring time.
alter table contests add column if not exists scoring_mode text;

-- Tier snapshot at entry time. The indexer reads getTier(agentId, cType)
-- once when EntryRegistered fires and stores it here, so the runner's
-- fetchField (called every 2.5s during the live window) reads from the
-- row instead of round-tripping N agents × M ticks to the chain. Null
-- on legacy rows; the runner falls back to a live read and backfills.
alter table entries add column if not exists tier int;
alter table challenge_entries add column if not exists tier int;

-- Treasury / payout flow from PrizeEscrow.PaidOut. Every USDC outflow
-- from a pool gets a row here: contest prize claims, challenge payouts,
-- listing fees to treasury, platform-fee skims. The (controller,
-- pool_id, recipient) keys let us reconcile this against contests /
-- challenges / treasury without re-parsing the raw events_log.
create table if not exists treasury_flow (
  id           bigserial primary key,
  controller   text not null,
  pool_id      numeric not null,
  recipient    text not null,
  amount       numeric not null,
  tx_hash      text not null,
  block_number bigint not null,
  log_index    int not null,
  created_at   timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists treasury_flow_recipient_idx on treasury_flow(recipient);
create index if not exists treasury_flow_pool_idx on treasury_flow(controller, pool_id);

-- Per-event log of syndicate ContributionRecorded events so we can roll
-- contributions up into rolling weekly windows. Existing
-- syndicates.total_reputation is cumulative all-time; this table is the
-- raw stream the war settler reads from. Keyed on (tx_hash, log_index)
-- so re-indexing a block range is idempotent.
create table if not exists syndicate_contributions (
  id           bigserial primary key,
  syndicate_id bigint not null,
  member       text not null,
  amount       numeric not null,
  tx_hash      text not null,
  block_number bigint not null,
  log_index    int not null,
  recorded_at  timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists syndicate_contrib_syn_idx on syndicate_contributions(syndicate_id, recorded_at);
create index if not exists syndicate_contrib_member_idx on syndicate_contributions(member, recorded_at);

-- Weekly war standings snapshot. The coordinator's settle job writes one
-- row per syndicate per ISO-week with the syndicate's rank and total
-- contribution that week. The scoring path reads the latest week's row
-- to apply the top-3 multiplier on the current week's contests.
-- `week_id` is the ISO-8601 year-week string ("2026-W22") so it's
-- human-readable and naturally sorts.
create table if not exists syndicate_war_results (
  week_id        text not null,
  syndicate_id   bigint not null,
  rank           int not null,
  total          numeric not null,
  member_count   int not null,
  settled_at     timestamptz not null default now(),
  primary key (week_id, syndicate_id)
);
create index if not exists war_results_week_idx on syndicate_war_results(week_id, rank);

-- Email OTP proof-of-ownership. Required before a never-seen email can
-- register a passkey for the first time (so an attacker can't claim
-- someone else's email and mint a Circle wallet under it). Returning
-- passkey users don't hit this path. Codes hash via sha256+pepper at
-- rest so a DB dump doesn't leak active codes. `verified_at` non-null
-- means /auth/email/begin can proceed within OTP_VERIFY_TTL.
create table if not exists email_otp (
  email        text primary key,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists challenges (
  id          bigint primary key,
  creator     text,
  kind        int,
  stake       numeric,
  status      text not null default 'open',
  winner_root text,
  pot         numeric,
  entrants    int not null default 0,
  created_at  timestamptz not null default now()
);

alter table challenges add column if not exists scoring_mode text;

create table if not exists syndicates (
  id               bigint primary key,
  name             text,
  founder          text,
  is_custom        boolean not null default false,
  total_reputation numeric not null default 0,
  member_count     bigint not null default 0
);

-- Raw event stream for debugging and replay. Unique on (tx, log index) so the
-- indexer is idempotent across restarts and overlapping ranges.
create table if not exists events_log (
  id           bigserial primary key,
  block_number bigint not null,
  tx_hash      text not null,
  log_index    int not null,
  address      text not null,
  event_name   text not null,
  args         jsonb not null,
  created_at   timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists events_log_block_idx on events_log(block_number);

-- Activity and error log. Clients and services append here (POST /events);
-- only the admin token can read it (GET /admin/events). Append-only audit stream.
create table if not exists events (
  id          bigserial primary key,
  level       text not null default 'info',  -- info | warn | error
  kind        text not null,                 -- login, contest_enter, client_error, ...
  message     text,
  context     jsonb,
  address     text,
  source      text not null default 'server', -- web | auth | coordinator | indexer
  created_at  timestamptz not null default now()
);
create index if not exists events_created_idx on events(created_at desc);
create index if not exists events_level_idx on events(level);

-- Settlement payouts the coordinator wrote, in the exact leaf order used to build
-- the merkle root. Serves claim proofs (GET /contests/:id/payout). Keyed by rank
-- so the rebuilt tree matches what was posted, even if an operator appears twice.
create table if not exists payouts (
  contest_id  bigint not null,
  rank        int not null,
  operator    text not null,
  amount      numeric not null,
  created_at  timestamptz not null default now(),
  primary key (contest_id, rank)
);
create index if not exists payouts_lookup_idx on payouts(contest_id, operator);

-- Peer-challenge entrants, from ChallengeArena's ChallengeJoined. Mirrors
-- `entries` so the coordinator can assemble and score a challenge's field.
create table if not exists challenge_entries (
  challenge_id bigint not null,
  agent_id     bigint not null,
  operator     text not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, agent_id)
);
create index if not exists challenge_entries_operator_idx on challenge_entries(operator);

-- Resolved challenge payouts, in leaf order, for serving claim proofs.
create table if not exists challenge_payouts (
  challenge_id bigint not null,
  rank         int not null,
  operator     text not null,
  amount       numeric not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, rank)
);
create index if not exists challenge_payouts_lookup_idx on challenge_payouts(challenge_id, operator);

-- Per-agent traits earned over time. Source records where the trait came from:
-- 'mystery' for daily mystery claims, 'contest' for top-N placements, 'challenge'
-- for challenge wins. The (agent_id, trait_id) pair is unique so each agent owns
-- each trait at most once.
create table if not exists agent_traits (
  agent_id     bigint not null,
  trait_id     text not null,
  source       text not null,
  source_ref   text,
  awarded_at   timestamptz not null default now(),
  primary key (agent_id, trait_id)
);
create index if not exists agent_traits_agent_idx on agent_traits(agent_id);

-- Per-operator mystery-claim cooldown. One row per operator, updated on every
-- claim. The "one per UTC day" rule is enforced by the auth service.
create table if not exists mystery_claims (
  operator     text primary key,
  last_claim   timestamptz not null,
  total_claims bigint not null default 0
);

-- Global daily pool counter. One row per UTC day. Each successful claim
-- increments `claimed`; the auth service refuses to award once `claimed`
-- reaches the configured `MYSTERY_DAILY_POOL`. Resets implicitly at midnight
-- UTC because a new day key creates a fresh row.
create table if not exists mystery_pool_daily (
  day      date primary key,
  claimed  bigint not null default 0
);

-- Per-agent skill training. Six stats (POWER, PRECISION, SPEED, ENDURANCE,
-- LUCK, FOCUS) each 0..20. Each level adds 1% to the relevant scoring
-- component in the coordinator pipeline. Funded by Cycles, time-gated.
create table if not exists agent_stats (
  agent_id bigint not null,
  stat     text not null,
  level    int not null default 0,
  primary key (agent_id, stat)
);
create index if not exists agent_stats_agent_idx on agent_stats(agent_id);

-- Active training slot. One row per agent at a time. When `completes_at` is
-- in the past, the next read promotes the row: bumps agent_stats.level and
-- writes a row to training_log, then deletes from this table.
create table if not exists training_queue (
  agent_id     bigint primary key,
  stat         text not null,
  from_level   int not null,
  to_level     int not null,
  cycles_spent bigint not null,
  started_at   timestamptz not null default now(),
  completes_at timestamptz not null
);

-- Private challenge invite list. The contract emits ChallengeInvited per
-- (id, invitee); the indexer mirrors it here so the frontend can render
-- "who's been invited" without scanning logs.
create table if not exists challenge_invites (
  challenge_id bigint not null,
  invitee      text   not null,
  created_at   timestamptz not null default now(),
  primary key (challenge_id, invitee)
);
create index if not exists challenge_invites_id_idx on challenge_invites(challenge_id);

-- Equipped trait loadouts per entry. ArcRun caps a loadout at three traits
-- and rejects clashing combinations. Used by the runner to fold the trait
-- multiplier (and any routing trait) into final score. Source distinguishes
-- contest entries from peer-challenge entries since the two have separate id
-- spaces.
create table if not exists entry_loadouts (
  source       text   not null, -- 'contest' or 'challenge'
  event_id     bigint not null,
  agent_id     bigint not null,
  operator     text   not null,
  trait_ids    text[] not null default '{}',
  created_at   timestamptz not null default now(),
  primary key (source, event_id, agent_id)
);
create index if not exists entry_loadouts_op_idx on entry_loadouts(operator);

-- Append-only log of every completed training step. Used for history on the
-- workshop card and for the future training_log feed on the dashboard.
create table if not exists training_log (
  id           bigserial primary key,
  agent_id     bigint not null,
  stat         text not null,
  from_level   int not null,
  to_level     int not null,
  cycles_spent bigint not null,
  completed_at timestamptz not null default now()
);
create index if not exists training_log_agent_idx on training_log(agent_id, completed_at desc);

-- Admin-only soft burn. An agent id listed here is filtered out of every
-- public agent listing (fetchAgents) so the operator profile, workshop,
-- dashboard, and contest entry pickers all treat it as removed. The on-chain
-- ERC-8004 NFT stays where it is; this only hides it from the ArcRun UI.
-- Users never see this table or any indication that delisting happened.
create table if not exists delisted_agents (
  agent_id     bigint primary key,
  delisted_at  timestamptz not null default now(),
  reason       text
);

-- ===========================================================================
-- Arcana Markets integration (read + index)
-- ===========================================================================
-- Cached state of every Arcana market the indexer has seen. Updated on
-- SharesBought (pool deltas), MarketResolved (outcome), and a periodic
-- reconciliation sweep that re-reads markets(i) for the latest N to catch
-- new markets created by the Arcana team. `outcome` is null until the market
-- resolves: true = YES won, false = NO won.
create table if not exists arcana_markets (
  market_id     bigint primary key,
  title         text not null default '',
  category      text not null default '',
  end_time      timestamptz not null,
  yes_pool      numeric(38, 0) not null default 0,
  no_pool       numeric(38, 0) not null default 0,
  resolved      boolean not null default false,
  cancelled     boolean not null default false,
  outcome       boolean,
  resolved_at   timestamptz,
  first_seen    timestamptz not null default now(),
  last_updated  timestamptz not null default now()
);
create index if not exists arcana_markets_open_idx
  on arcana_markets(end_time)
  where resolved = false and cancelled = false;
create index if not exists arcana_markets_resolved_idx
  on arcana_markets(resolved_at desc)
  where resolved = true;

-- Every USDC trade an agent places against the Arcana contract. One row per
-- buyShares call. Linked to the contest round that prompted it so we can
-- compute per-agent PnL inside a round window. `pnl_usdc` is filled when the
-- market resolves (positive = won, negative = lost stake to the other pool).
create table if not exists agent_positions (
  id              bigserial primary key,
  contest_id      bigint not null,
  agent_id        bigint not null,
  operator        text not null,
  market_id       bigint not null,
  side            text not null check (side in ('yes', 'no')),
  stake_usdc      numeric(38, 0) not null,
  shares          numeric(38, 0),
  entry_yes_pool  numeric(38, 0) not null default 0,
  entry_no_pool   numeric(38, 0) not null default 0,
  tx_hash         text,
  block_number    bigint,
  claimed         boolean not null default false,
  claim_tx_hash   text,
  pnl_usdc        numeric(38, 0),
  created_at      timestamptz not null default now()
);
create index if not exists agent_positions_contest_idx
  on agent_positions(contest_id, agent_id);
create index if not exists agent_positions_market_idx
  on agent_positions(market_id);
create index if not exists agent_positions_unclaimed_idx
  on agent_positions(market_id, claimed)
  where claimed = false;

-- Replayable raw event log for the Arcana contract. Kept separate from
-- events_log (ArcRun-native contracts) so a partner-contract change can be
-- re-played without touching the rest of the system.
create table if not exists arcana_events (
  id            bigserial primary key,
  block_number  bigint not null,
  tx_hash       text not null,
  log_index     int not null,
  event_kind    text not null,  -- 'SharesBought' | 'MarketResolved' | 'WinningsClaimed'
  market_id     bigint not null,
  args          jsonb not null,
  created_at    timestamptz not null default now(),
  unique (tx_hash, log_index)
);
create index if not exists arcana_events_market_idx
  on arcana_events(market_id, block_number);
create index if not exists arcana_events_kind_idx
  on arcana_events(event_kind, block_number desc);

-- The indexer tracks Arcana progress separately so the existing indexer_state
-- row keeps describing the ArcRun-contracts indexer. Single row, id=1.
create table if not exists arcana_indexer_state (
  id            int primary key,
  last_block    bigint not null,
  updated_at    timestamptz not null default now()
);

-- Phase 1 tick-driven prediction model. One row per agent decision tick
-- during a contest/challenge trade window. `tick_idx` is the agent's
-- per-event tick counter (0-based); the unique index gives at-most-once
-- semantics so a scheduler crash + restart doesn't double-fire a tick.
-- `action` is the LLM's decision: OPEN_YES / OPEN_NO opens a position,
-- HEDGE_YES / HEDGE_NO buys the opposite side of an existing position
-- to cut exposure, HOLD records that the agent saw the tick and chose
-- not to act (still counts toward the budget). market_id + stake_usdc
-- are null for HOLD ticks.
create table if not exists agent_decisions (
  id            bigserial primary key,
  source        text not null,                       -- 'contest' | 'challenge'
  event_id      bigint not null,                     -- contest id or challenge id
  agent_id      bigint not null,
  operator      text not null,
  tick_idx      int not null,
  action        text not null,                       -- OPEN_YES | OPEN_NO | HEDGE_YES | HEDGE_NO | HOLD
  market_id     bigint,
  stake_usdc    numeric(38, 0),
  tx_hash       text,
  rationale     text,
  decided_at    timestamptz not null default now(),
  unique (source, event_id, agent_id, tick_idx)
);
create index if not exists agent_decisions_event_idx
  on agent_decisions(source, event_id);
create index if not exists agent_decisions_agent_idx
  on agent_decisions(agent_id, decided_at desc);

-- Per-contest pinned market set. When the coordinator opens an Analyst
-- contest, it selects N open Arcana markets up-front and persists them
-- here. The runner reads from this table so every agent in the round sees
-- the same menu and the round is deterministic. The pool snapshots let
-- the live page show entry-time odds even after the pools drift.
create table if not exists contest_arcana_markets (
  contest_id        bigint not null,
  market_id         bigint not null,
  title             text not null default '',
  category          text not null default '',
  end_time          timestamptz not null,
  entry_yes_pool    numeric(38, 0) not null default 0,
  entry_no_pool     numeric(38, 0) not null default 0,
  pinned_at         timestamptz not null default now(),
  primary key (contest_id, market_id)
);
create index if not exists contest_arcana_markets_lookup_idx on contest_arcana_markets(contest_id);

-- Coordinator-side autofund tracking. One row per drip sent. The unique
-- index on (agent_id, drip_day) gives us the one-drip-per-agent-per-day
-- guarantee at the DB layer; the global daily cap is enforced in the caller
-- by summing amount_usd for the current drip_day. drip_day is the UTC date
-- the drip belongs to, so the day boundary matches everywhere.
create table if not exists analyst_autofund_log (
  id            bigserial primary key,
  agent_id      bigint not null,
  operator      text not null,
  drip_day      date not null,
  amount_usd    numeric(10, 2) not null,
  tx_hash       text not null,
  created_at    timestamptz not null default now(),
  unique (agent_id, drip_day)
);
create index if not exists analyst_autofund_day_idx on analyst_autofund_log(drip_day desc);

-- Nanopayments: every paid x402 call made by an agent during a contest.
-- One row per call, regardless of HTTP status. status='settled' means the
-- usdc moved and the response payload arrived. 'rejected' means the call
-- was budget-blocked before any USDC moved. 'failed' means the call paid
-- but the upstream API returned an error after settlement.
create table if not exists nanopayments (
  id                bigserial primary key,
  agent_id          bigint not null,
  contest_id        bigint,
  challenge_id      bigint,
  puzzle_idx        int not null default 0,
  tier              int not null,
  endpoint          text not null,
  endpoint_label    text,
  -- USDC 6-decimal as a string so we don't lose precision through json.
  usdc_amount_6     text not null default '0',
  chain             text not null default 'ARC',
  tx_hash           text,
  status            text not null default 'pending',
  response_summary  text,
  error_message     text,
  budget_remaining_6 text,
  created_at        timestamptz not null default now()
);
create index if not exists nanopayments_agent_idx on nanopayments(agent_id);
create index if not exists nanopayments_contest_idx on nanopayments(contest_id, puzzle_idx);
create index if not exists nanopayments_challenge_idx on nanopayments(challenge_id, puzzle_idx);
create index if not exists nanopayments_recent_idx on nanopayments(created_at desc);

-- Tier-pool Gateway state. One row per tier (0..4). Tracks the wallet
-- address, Gateway-deposited USDC balance snapshot, and the cumulative
-- spend across contests. Coordinator refreshes balance_usdc_6 on each
-- top-up and after each settlement sweep.
create table if not exists tier_pool_state (
  tier                int primary key,
  wallet_address      text not null,
  wallet_id           text,
  balance_usdc_6      text not null default '0',
  lifetime_spend_6    text not null default '0',
  per_puzzle_cap_6    text not null default '0',
  last_updated_at     timestamptz not null default now()
);
