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
-- X profile image, captured at link time. Used when an agent's display mode
-- is "x" so it can show the operator's X avatar alongside the handle.
alter table operators add column if not exists x_avatar text;
-- Telegram / Discord profile images, captured at link time (Telegram from the
-- login widget's photo_url, Discord from the OAuth avatar hash). Neither can be
-- resolved from a username after the fact, so we store the URL when linking.
alter table operators add column if not exists telegram_avatar text;
alter table operators add column if not exists discord_avatar text;
-- Operator-level identity shown on the leaderboard row and public profile.
-- 'auto' resolves X first, then Discord, then the masked wallet. The operator
-- can pin it from their profile: 'x', 'discord', 'custom' (first agent skin +
-- name), or 'wallet' to force the masked address. Distinct from per-agent
-- display_mode, which only governs how an agent appears inside a live event.
alter table operators add column if not exists identity_mode text not null default 'auto';
-- Email and Circle Dev-Controlled wallet linkage. An operator row exists for
-- both SIWE-only users (email/circle null) and email-login users (email set,
-- circle_wallet_id set). When circle_wallet_id is non-null the backend signs
-- writes on the operator's behalf through Circle. Email is unique so the same
-- mailbox cannot register two wallets.
alter table operators add column if not exists email text;
alter table operators add column if not exists circle_wallet_id text;
create unique index if not exists operators_email_idx on operators(email) where email is not null;
create unique index if not exists operators_circle_wallet_idx on operators(circle_wallet_id) where circle_wallet_id is not null;

-- Per-user Circle dev-controlled wallets on SOURCE chains, used for cross-chain
-- TOP UP: the user funds `address` on `chain` (an App Kit chain name like
-- "Base_Sepolia"), then the backend bridges it to their Arc wallet. One row per
-- (operator, chain); provisioned on demand and reused, so a user only ever has
-- one deposit wallet per chain. The operator's main Arc wallet stays in
-- operators.circle_wallet_id and is not duplicated here.
create table if not exists circle_chain_wallets (
  operator   text not null,
  chain      text not null,
  wallet_id  text not null,
  address    text not null,
  created_at timestamptz not null default now(),
  primary key (operator, chain)
);

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
-- Last time the nickname changed, for the once-every-30-days rename cooldown.
alter table agents add column if not exists nickname_updated_at timestamptz;
-- Custom skin: base64 data URL (image/png|jpeg|webp|gif), capped 256KB on the
-- server. Null means "use the mascot variant fallback".
alter table agents add column if not exists skin text;
-- Display identity for the agent: which name+avatar to show.
--   'default' -> robot mascot + default name (#id)
--   'x'       -> owner's X handle + X avatar (falls back to default if unlinked)
--   'custom'  -> uploaded skin + nickname (falls back to default if none)
-- Defaults to 'x' so a fresh agent reads as the operator's X identity when
-- one is linked, and as the robot otherwise.
alter table agents add column if not exists display_mode text not null default 'x';

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
-- Creator-set prize distribution. payout_preset is a key from PAYOUT_PRESETS
-- (winner_take_all | top2 | top3 | top5_half_field | even_all) or 'custom';
-- payout_config holds the custom { winnersBps:[], restSharedBps } when custom.
-- Null = legacy scoring-mode curve, so old contests settle unchanged.
alter table contests add column if not exists payout_preset text;
alter table contests add column if not exists payout_config jsonb;

-- Tier snapshot at entry time. The indexer reads getTier(agentId, cType)
-- once when EntryRegistered fires and stores it here, so the runner's
-- fetchField (called every 2.5s during the live window) reads from the
-- row instead of round-tripping N agents × M ticks to the chain. Null
-- on legacy rows; the runner falls back to a live read and backfills.
alter table entries add column if not exists tier int;
-- challenge_entries.tier is added right after that table is created below;
-- altering it here would fail on a fresh DB where the table doesn't exist yet.

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

-- Idempotency guard for syndicate contribution recording. recordContribution is
-- ADDITIVE on-chain, so an event's reputation must roll into its syndicate at
-- most once, ever. The settlement path and the backfill both claim the event
-- here first (insert on conflict do nothing); a claim that finds the row already
-- present skips, so re-running a backfill or replaying an event never
-- double-counts. Keyed by (source, event_id): a contest 88 and a challenge 88
-- are distinct.
create table if not exists syndicate_contrib_events (
  source      text not null,        -- 'contest' | 'challenge'
  event_id    bigint not null,
  recorded_at timestamptz not null default now(),
  primary key (source, event_id)
);

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

-- Weekly syndicate reward pool. One row per ISO-week with the total USDC set
-- aside (6-dec), computed once at week close. The row's existence is the guard
-- that the week was already split, so the computation is idempotent.
create table if not exists syndicate_pool_weeks (
  week_id     text primary key,
  pool_usdc6  numeric not null,
  computed_at timestamptz not null default now()
);

-- Per-member share of a week's pool, split by contribution. claimed flips when
-- the member pulls it; claim_tx records the on-chain transfer. Unclaimed shares
-- simply accumulate across weeks until claimed.
create table if not exists syndicate_pool_shares (
  week_id      text not null,
  operator     text not null,
  syndicate_id bigint not null,
  share_usdc6  numeric not null,
  claimed      boolean not null default false,
  claim_tx     text,
  claimed_at   timestamptz,
  primary key (week_id, operator)
);
create index if not exists syndicate_pool_shares_op_idx on syndicate_pool_shares(operator, claimed);

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
-- Creator-set prize distribution, same shape as contests above.
alter table challenges add column if not exists payout_preset text;
alter table challenges add column if not exists payout_config jsonb;

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

-- Final standings snapshot for replay. When an event settles, the coordinator
-- saves the last standings frame (the same {rank, agentId, operator, score,
-- progress}[] it broadcasts live) here, so visiting/refreshing a settled event
-- reconstructs the FULL result — volumes, ops, tx hashes, solver cells, research
-- spend — for someone who never watched it live. source is 'contest'|'challenge'.
create table if not exists event_standings (
  source      text not null,
  event_id    bigint not null,
  entries     jsonb not null,
  settled_at  timestamptz not null default now(),
  primary key (source, event_id)
);

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
-- Tier snapshot at entry time (see the entries.tier note above). Added here,
-- after the create, so a fresh DB has the table before the column is added.
alter table challenge_entries add column if not exists tier int;

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
-- `claimed` counts ROLLS (100/day). `won` counts traits actually awarded, which
-- is the scarce cap (3/day, 7 on a bonus day). Most rolls rug.
alter table mystery_pool_daily add column if not exists won bigint not null default 0;

-- Pool of LLM-generated, source-grounded, grader-verified puzzles. A background
-- job tops this up; contests draw from it (skipping recently-used) and fall back
-- to the deterministic templates when it's thin. `content_hash` dedupes so a
-- question never enters twice. `source` carries the doc provenance for display.
create table if not exists generated_puzzles (
  id           bigserial primary key,
  content_hash text not null unique,
  kind         text not null,
  prompt       text not null,
  expected     text not null,
  presentation jsonb not null,
  difficulty   int not null default 2,
  source       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  use_count    bigint not null default 0
);
create index if not exists generated_puzzles_pick
  on generated_puzzles (difficulty, last_used_at nulls first, id);

-- Consecutive contest wins per operator. Winning (placing #1) a contest bumps
-- the streak; any other finish resets it. 5 in a row unlocks a rare trait, 10
-- in a row a legendary (then the streak resets). The skill-based path to traits,
-- alongside the daily mystery box.
create table if not exists win_streaks (
  operator   text primary key,
  streak     int not null default 0,
  updated_at timestamptz not null default now()
);

-- Weekly Cycle drop to the top syndicates (funds training). One row per settled
-- ISO week guards against re-dropping when the hourly settler re-runs.
create table if not exists syndicate_cycle_drops (
  week_id    text primary key,
  dropped_at timestamptz not null default now()
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

-- Custom contest/challenge requests. A project that wants a campaign shaped
-- to its own metric submits one here; ArcRun reviews it and coordinates the
-- wiring offline. status moves pending -> reviewing -> accepted | declined.
create table if not exists custom_requests (
  id          bigserial primary key,
  operator    text,
  surface     text not null,            -- 'contest' | 'challenge'
  kind        text,                     -- requested type/kind label
  contact     text not null,            -- how ArcRun reaches the project
  spec        text not null,            -- the metric and rules described
  status      text not null default 'pending',
  created_at  timestamptz not null default now()
);
create index if not exists custom_requests_status_idx on custom_requests(status, created_at desc);
create index if not exists custom_requests_operator_idx on custom_requests(operator);

-- In-app notifications. One row per operator-targeted event (new contest,
-- private invite, win, balance change, training done, mystery win, custom
-- request update). The auth API serves a per-operator feed; the coordinator
-- and auth service insert rows and push them over the WebSocket. `kind`
-- drives the icon and sound on the client; `body` is the rendered line.
create table if not exists notifications (
  id          bigserial primary key,
  operator    text not null,
  kind        text not null,
  title       text not null,
  body        text,
  href        text,
  context     jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_operator_idx on notifications(operator, created_at desc);
create index if not exists notifications_unread_idx on notifications(operator, read);

-- Tier gates on contests and challenges. The contracts don't store a tier
-- restriction, so the gate lives here: the host records it at creation, the
-- entry UI blocks out-of-range agents, and the coordinator excludes any
-- out-of-range entry at settlement so an on-chain bypass can't win. Absent
-- row means open to all tiers (0..4).
create table if not exists event_tier_gates (
  surface     text not null,            -- 'contest' | 'challenge'
  event_id    bigint not null,
  min_tier    int not null default 0,
  max_tier    int not null default 4,
  created_at  timestamptz not null default now(),
  primary key (surface, event_id)
);

-- Per-agent daily swap budget for the Scout real-swap path. Every tier gets
-- the same daily cap, so a lower-tier agent (smaller funding) has to swap
-- more times to match the volume of a higher-tier agent. Keyed by UTC day.
create table if not exists scout_swap_budget (
  agent_id    bigint not null,
  day         date not null,
  used        int not null default 0,
  primary key (agent_id, day)
);

-- Admin ops queue. The admin console (auth API process) enqueues a command;
-- the coordinator process drains it and executes through its own single-flight
-- guard, so manual settle/resolve/cancel run in the SAME place as the autopilot
-- sweeper (one nonce owner, real WS broadcast) instead of racing it from the API
-- process. Status flows pending -> running -> done | error.
create table if not exists admin_commands (
  id           bigserial primary key,
  kind         text not null,            -- 'settle_contest' | 'resolve_challenge' | 'cancel_contest' | 'cancel_challenge'
  target_id    bigint not null,
  status       text not null default 'pending',  -- 'pending' | 'running' | 'done' | 'error'
  result       text,
  requested_by text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists admin_commands_pending_idx on admin_commands (status, id) where status = 'pending';
-- Optional per-command params (open_mission carries {domain, poolUsdc, windowSeconds}).
alter table admin_commands add column if not exists params jsonb;

-- Missions: the agent labor market (full design in docs/missions.md). A mission
-- is a SOLVER-type contest tagged here. `domain` (solver | analyst | scout)
-- decides the operative's work: solver/analyst MAKE fragments by paying x402
-- services; scout MAKEs by doing on-chain DeFi work. One row per mission, keyed
-- by the on-chain contest id (no contract redeploy).
create table if not exists missions (
  contest_id    bigint primary key,
  domain        text not null,            -- 'solver' | 'analyst' | 'scout'
  template_id   text not null,
  title         text not null,
  brief         text not null,
  deliverable   text not null,
  status        text not null default 'open',  -- 'open' | 'settled' | 'cancelled'
  created_at    timestamptz not null default now()
);
-- v2 economy (docs/missions.md s1c): archetype decides external-x402 vs the
-- internal intel market; weight (0..1) and base_price set the intel price band;
-- pool_usdc_6 is the prize pool (stored here so the operative join fee, a % of
-- it, is computable without an on-chain read).
alter table missions add column if not exists archetype         text    not null default 'internal';
alter table missions add column if not exists weight            numeric not null default 0;
alter table missions add column if not exists base_price_usdc_6 text    not null default '0';
alter table missions add column if not exists pool_usdc_6       text    not null default '0';
-- A display sequence so missions read as "MISSION 001" rather than the on-chain
-- contest id (one counter across all contests). The URL still uses contest_id.
create sequence if not exists mission_display_seq;
alter table missions add column if not exists seq bigint not null default nextval('mission_display_seq');
-- Per-mission seat caps. NULL falls back to the global MISSION_*_SEATS config,
-- so an admin can open a bigger or smaller field for one mission without
-- changing the env for every mission.
alter table missions add column if not exists operative_seats  int;
alter table missions add column if not exists specialist_seats int;
-- Per-mission operative join fee (basis points). NULL = the global
-- MISSION_OPERATIVE_FEE_BPS. Lets an admin tune the fee for one mission.
alter table missions add column if not exists operative_fee_bps int;
create index if not exists missions_status_idx on missions(status, created_at desc);

-- The fragments a mission's brief asks for, with the captured ground truth. The
-- service columns name the x402 endpoint that can MAKE the fragment (null for
-- scout `action` fragments). `truth` is what the grader checks against and what
-- the platform specialists are seeded to hold.
create table if not exists mission_fragments (
  contest_id      bigint not null,
  fragment_id     text not null,
  kind            text not null,          -- 'intel' | 'signal' | 'market' | 'action'
  ask             text not null,
  service_endpoint text,
  service_label   text,
  service_chain   text,
  truth           jsonb,
  created_at      timestamptz not null default now(),
  primary key (contest_id, fragment_id)
);

-- Platform-seeded specialist (intel-seller) agents. Each holds the captured intel
-- for a fragment and prices it; serves it over the A2A handshake on a paid BUY.
-- agent_id is on the reserved specialist range (MISSION_SPECIALIST_AGENT_ID_BASE)
-- and the address is its derived hot wallet.
create table if not exists mission_specialists (
  contest_id   bigint not null,
  agent_id     bigint not null,
  address      text not null,
  fragment_id  text not null,
  price_usdc_6 text not null default '0',
  intel        jsonb,
  created_at   timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
-- Recent mission subjects (v2 diversity). One row per subject a mission used, so
-- the generator can avoid anything seen in the last 60 days and missions never
-- feel repeated. subject_key is the lowercased subject.
create table if not exists mission_subjects (
  subject_key text not null,
  contest_id  bigint not null,
  created_at  timestamptz not null default now(),
  primary key (subject_key, contest_id)
);
create index if not exists mission_subjects_recent_idx on mission_subjects(created_at desc);

-- Operative join fees (v2 economy). An operative pays a % of the pool to the
-- treasury when it enters a mission; recorded here so the fee can be refunded
-- from the treasury if the mission cancels with no qualifier. One row per
-- operator per mission (re-paying is idempotent on the key).
create table if not exists mission_operative_fees (
  contest_id   bigint not null,
  operator     text not null,
  amount_usdc_6 text not null,
  tx_hash      text,
  refunded     boolean not null default false,
  refund_tx    text,
  created_at   timestamptz not null default now(),
  primary key (contest_id, operator)
);
-- Why a fee was returned: 'cancel' (mission voided), 'withdraw' (operative left
-- the join window), or 'participation' (the operative put >= the configured
-- fraction of its float to work on real spend, so it earned the fee back at a
-- settled mission). NULL on rows never refunded. Additive for existing DBs.
alter table mission_operative_fees add column if not exists refund_reason text;

-- Operator-run specialists: an operator can enter a mission on the SUPPLY side,
-- registering one of their agents to sell intel for a fragment at their own
-- price. `owner` distinguishes them from the platform-seeded sellers; `operator`
-- is the wallet the A2A payment lands in when an operative buys. `claimed_by` is
-- set on a PLATFORM row once a specialist buys that piece, making it exclusive:
-- the platform no longer sells it (only the specialist resells). Added after the
-- create so existing DBs gain the columns.
alter table mission_specialists add column if not exists owner      text not null default 'platform';
alter table mission_specialists add column if not exists operator   text;
alter table mission_specialists add column if not exists claimed_by text;

-- The scarce-intel market ledger (v2). One row per piece a specialist buys from
-- the platform shelf at the base price `b`, then resells at `resale_price_6`. The
-- (contest_id, fragment_id) primary key enforces exclusivity: a piece has at most
-- one buyer. Refunded from the treasury if the mission cancels.
create table if not exists mission_intel_buys (
  contest_id     bigint not null,
  fragment_id    text not null,
  operator       text not null,
  agent_id       bigint not null,
  base_price_6   text not null,
  resale_price_6 text not null,
  tx_hash        text,
  refunded       boolean not null default false,
  refund_tx      text,
  created_at     timestamptz not null default now(),
  primary key (contest_id, fragment_id)
);
create index if not exists mission_intel_buys_op_idx on mission_intel_buys(contest_id, operator);
create index if not exists mission_specialists_contest_idx on mission_specialists(contest_id);

-- An operative who entered a mission and changed their mind WITHIN the join
-- window (mission still open) can withdraw. We cannot undo their on-chain
-- registerEntry, so the withdrawal is recorded here and every read of the
-- operative field — grading (fetchField), the concurrency guard, the my-role
-- lock, and the operative seat count — excludes a withdrawn operator. The join
-- fee (if any was paid) is returned from the treasury; fee_refund_tx records it.
-- Keyed by (contest_id, operator); one withdrawal per operative per mission.
create table if not exists mission_withdrawals (
  contest_id    bigint not null,
  operator      text not null,
  agent_id      bigint,
  fee_refunded  boolean not null default false,
  fee_refund_tx text,
  created_at    timestamptz not null default now(),
  primary key (contest_id, operator)
);
create index if not exists mission_withdrawals_contest_idx on mission_withdrawals(contest_id);

-- Agent-to-agent trades: the on-chain USDC payment from an operative (buyer) to a
-- specialist (seller) for a fragment over the bounded handshake. This is the A2A
-- rail's settlement record; tx_hash is the real USDC Transfer.
create table if not exists a2a_trades (
  id            bigserial primary key,
  contest_id    bigint not null,
  buyer_agent_id  bigint not null,
  seller_agent_id bigint not null,
  fragment_id   text not null,
  price_usdc_6  text not null default '0',
  tx_hash       text,
  status        text not null default 'pending',  -- 'pending' | 'settled' | 'failed' | 'declined'
  created_at    timestamptz not null default now()
);
-- The NEGOTIATE pillar. A trade now records what the seller ASKED as well as what
-- was PAID, plus the handshake that got them there, so a bargain is provable after
-- the fact instead of being a claim. quoted_usdc_6 = price_usdc_6 when the ask was
-- firm (an operator listing) or nothing was conceded.
-- Added as ALTER ... IF NOT EXISTS rather than in the create above, so an existing
-- deployment migrates in place. schema.sql runs as ONE query, so a statement that
-- throws kills the whole migrate job: keep every statement here idempotent.
alter table a2a_trades add column if not exists quoted_usdc_6 text;
alter table a2a_trades add column if not exists rounds integer not null default 0;
alter table a2a_trades add column if not exists transcript jsonb;
create index if not exists a2a_trades_contest_idx on a2a_trades(contest_id);
create index if not exists a2a_trades_buyer_idx on a2a_trades(buyer_agent_id);
create index if not exists a2a_trades_recent_idx on a2a_trades(created_at desc);

-- Per-operative make/buy/skip decision log, one row per fragment the operative
-- considered. `tx_hash` is the on-chain proof the grader's credit gate checks:
-- an x402 tx (make), an a2a_trades tx (buy), or a DeFi action tx (scout).
create table if not exists mission_decisions (
  contest_id          bigint not null,
  agent_id            bigint not null,
  fragment_id         text not null,
  choice              text not null,      -- 'make' | 'buy' | 'skip'
  reason              text,
  settled             boolean not null default false,
  tx_hash             text,
  spent_usdc_6        text not null default '0',
  specialist_agent_id bigint,
  created_at          timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
create index if not exists mission_decisions_contest_idx on mission_decisions(contest_id, agent_id);

-- SCOUT-domain missions execute an on-chain DeFi ACTION fragment (real swaps on
-- the Scout rails) instead of a make/buy. This is the proof row the grader's
-- credit gate re-verifies for an `action` decision, exactly as it verifies
-- a2a_trades for a buy and nanopayments for a make: an action counts only when a
-- settled row here carries the same tx_hash. volume_usdc_6 is what the scout
-- quality score is normalized against.
create table if not exists mission_actions (
  contest_id     bigint not null,
  agent_id       bigint not null,
  fragment_id    text not null,
  tx_hash        text,
  volume_usdc_6  text not null default '0',
  ops            int not null default 0,
  status         text not null default 'pending',  -- 'pending' | 'settled' | 'failed'
  created_at     timestamptz not null default now(),
  primary key (contest_id, agent_id, fragment_id)
);
create index if not exists mission_actions_contest_idx on mission_actions(contest_id, agent_id);

-- The operative's submitted deliverable and its grade. score is the deterministic
-- value fed into the merkle payout; `judged` holds the judge.ts verdict detail.
create table if not exists mission_submissions (
  contest_id   bigint not null,
  agent_id     bigint not null,
  operator     text not null,
  deliverable  text,
  elapsed_ms   int not null default 0,
  score        numeric,
  judged       jsonb,
  created_at   timestamptz not null default now(),
  primary key (contest_id, agent_id)
);

-- Autonomous agents: an agent that OWNS ITSELF. Its Circle Developer-Controlled
-- Wallet holds the ERC-8004 identity NFT, so on chain the agent is its own
-- operator and can register its own contest entries. This is the only shape that
-- works: ContestEngine.registerEntry requires msg.sender == ownerOfAgent(agentId)
-- and allows one entry per owner per contest, so an agent entered by a human
-- shares that human's single seat. A self-owned agent has its own.
create table if not exists autonomous_agents (
  id            bigserial primary key,
  agent_id      bigint unique,               -- null until createAgent() lands
  wallet_id     text not null unique,        -- Circle DCW wallet id
  address       text not null unique,        -- the wallet, and the agent's owner
  label         text not null,
  budget_usdc_6 numeric not null default 0,  -- hard ceiling it may ever spend
  spent_usdc_6  numeric not null default 0,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Every autonomous decision, with the model's own stated reason. The point is to
-- be able to show WHY an agent acted, not merely that it did.
--
-- NOT called agent_decisions: that name is already taken by the Analyst runner's
-- prediction-market tick log (see above). Reusing it made `create table if not
-- exists` a silent no-op, and the index below then failed on a column the older
-- table does not have, which broke the migrate job on deploy.
create table if not exists autonomy_decisions (
  id          bigserial primary key,
  agent_id    bigint,
  address     text not null,
  kind        text not null,                 -- enter | skip | upgrade | error
  contest_id  bigint,
  reason      text not null default '',
  cost_usdc_6 numeric not null default 0,
  tx_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists autonomy_decisions_agent_idx on autonomy_decisions (agent_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agon Market foundation
--
-- These tables are isolated from the legacy ArcRun read model. Chain-derived
-- identifiers use numeric so uint256 values never cross a JavaScript float.
-- Addresses and hashes are stored as canonical lowercase hex. Raw chain events,
-- validated listing versions, and listing audits are append-only provenance.
-- ---------------------------------------------------------------------------

create table if not exists agon_profiles (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  profile_registry_address    text not null check (profile_registry_address ~ '^0x[0-9a-f]{40}$'),
  identity_registry_address   text not null check (identity_registry_address ~ '^0x[0-9a-f]{40}$'),
  agent_id                    numeric(78, 0) not null check (agent_id > 0),
  owner_snapshot              text not null check (owner_snapshot ~ '^0x[0-9a-f]{40}$'),
  metadata_uri                text not null check (char_length(metadata_uri) between 1 and 2048),
  status                      text not null check (status in ('Active', 'Suspended', 'Archived')),
  suspension_reason           text check (suspension_reason is null or suspension_reason ~ '^0x[0-9a-f]{64}$'),
  source_block_number         numeric(78, 0) not null check (source_block_number >= 0),
  source_tx_hash              text not null check (source_tx_hash ~ '^0x[0-9a-f]{64}$'),
  source_log_index            integer not null check (source_log_index >= 0),
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  primary key (chain_id, profile_registry_address, agent_id)
);
create index if not exists agon_profiles_owner_idx
  on agon_profiles(chain_id, identity_registry_address, owner_snapshot);
create index if not exists agon_profiles_status_idx
  on agon_profiles(chain_id, status, updated_at desc);

create table if not exists agon_listings (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  agent_id                    numeric(78, 0) not null check (agent_id > 0),
  service_key                 text not null check (service_key ~ '^0x[0-9a-f]{64}$'),
  category                    numeric(78, 0) not null check (category > 0),
  current_version             numeric(78, 0) not null check (current_version > 0),
  manifest_hash               text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri                text not null check (char_length(manifest_uri) > 0),
  payment_rail                text not null check (payment_rail in ('X402', 'Escrow')),
  provider_snapshot           text not null check (provider_snapshot ~ '^0x[0-9a-f]{40}$'),
  chain_status                text not null check (chain_status in ('Listed', 'Suspended', 'Delisted')),
  status                      text not null check (status in ('Listed', 'Suspended', 'Delisted')),
  verification                text not null check (
    verification in ('Unverified', 'Pending', 'Verified', 'Expired', 'Suspended', 'Revoked')
  ),
  quarantine_reason           text,
  source_block_number         numeric(78, 0) not null check (source_block_number >= 0),
  source_tx_hash              text not null check (source_tx_hash ~ '^0x[0-9a-f]{64}$'),
  source_log_index            integer not null check (source_log_index >= 0),
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  primary key (chain_id, service_registry_address, listing_id)
);
create unique index if not exists agon_listings_service_key_unique
  on agon_listings(chain_id, service_registry_address, agent_id, service_key);
create index if not exists agon_listings_discovery_idx
  on agon_listings(chain_id, status, verification, category, updated_at desc);
create index if not exists agon_listings_agent_idx
  on agon_listings(chain_id, agent_id, updated_at desc);

-- A row is the exact manifest/provider/version tuple that passed local
-- validation before activation. The projector compares chain anchors to this
-- table. Rows cannot be edited after insertion; a new manifest is a new version.
create table if not exists agon_listing_versions (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  version                     numeric(78, 0) not null check (version > 0),
  manifest_hash               text not null check (manifest_hash ~ '^0x[0-9a-f]{64}$'),
  manifest_uri                text not null check (char_length(manifest_uri) > 0),
  payment_rail                text not null check (payment_rail in ('X402', 'Escrow')),
  provider_snapshot           text not null check (provider_snapshot ~ '^0x[0-9a-f]{40}$'),
  validated_at                timestamptz not null,
  primary key (chain_id, service_registry_address, listing_id, version)
);
create index if not exists agon_listing_versions_hash_idx
  on agon_listing_versions(chain_id, manifest_hash);

create table if not exists agon_listing_events (
  id                          bigserial primary key,
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  version                     numeric(78, 0) check (version is null or version > 0),
  event_type                  text not null check (
    event_type in ('published', 'version_published', 'status_changed', 'verification_changed', 'quarantined')
  ),
  payload                     jsonb not null,
  tx_hash                     text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index                   integer not null check (log_index >= 0),
  block_number                numeric(78, 0) not null check (block_number >= 0),
  block_hash                  text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  observed_at                 timestamptz not null,
  unique (chain_id, tx_hash, log_index, event_type)
);
create index if not exists agon_listing_events_listing_idx
  on agon_listing_events(chain_id, service_registry_address, listing_id, id);
create index if not exists agon_listing_events_block_idx
  on agon_listing_events(chain_id, block_number, log_index);

create table if not exists agon_chain_events (
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  contract_address            text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash                     text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index                   integer not null check (log_index >= 0),
  block_number                numeric(78, 0) not null check (block_number >= 0),
  block_hash                  text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  event_name                  text not null,
  args                        jsonb not null,
  observed_at                 timestamptz not null,
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists agon_chain_events_contract_block_idx
  on agon_chain_events(chain_id, contract_address, block_number, log_index);

-- Wallet-neutral Agon writes are prepared before the user's own wallet signs
-- them, then confirmed only after the backend matches a successful canonical
-- contract event. This ledger makes both phases durable and idempotent.
create table if not exists agon_write_operations (
  operation_id        uuid primary key,
  actor_address       text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  operation_kind      text not null check (operation_kind in ('bind_profile', 'publish_listing')),
  payload_hash        text not null check (payload_hash ~ '^0x[0-9a-f]{64}$'),
  request_payload     jsonb not null,
  transaction_intent jsonb not null,
  state               text not null default 'prepared' check (state in ('prepared', 'confirmed')),
  tx_hash             text unique check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  result_reference    text,
  block_number        numeric(78, 0) check (block_number is null or block_number >= 0),
  log_index           integer check (log_index is null or log_index >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (actor_address, operation_kind, payload_hash),
  check (
    (state = 'prepared' and tx_hash is null and block_number is null and log_index is null)
    or
    (state = 'confirmed' and tx_hash is not null and block_number is not null and log_index is not null)
  )
);
create index if not exists agon_write_operations_actor_idx
  on agon_write_operations(actor_address, created_at desc);

create table if not exists agon_verification_evidence (
  id              bigserial primary key,
  listing_id      numeric(78, 0) not null check (listing_id > 0),
  agent_id        numeric(78, 0) not null check (agent_id >= 0),
  passed          boolean not null,
  evidence_hash   text not null check (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  evidence        jsonb not null,
  verifier       text not null default 'agon-verifier-agent',
  created_at      timestamptz not null default now()
);
create index if not exists agon_verification_evidence_listing_idx
  on agon_verification_evidence(listing_id, created_at desc);

-- Durable buyer-side x402 preparation. This is an authorization boundary, not
-- a payment ledger: the row is written before any future Circle call and is
-- intentionally stuck in `prepared` while the execution adapter is disabled.
-- The actor + idempotency key pair prevents duplicate intent creation and the
-- input hash makes a retry with changed economics or payload fail closed.
create table if not exists agon_x402_call_intents (
  intent_id                   uuid primary key,
  actor_address               text not null check (actor_address ~ '^0x[0-9a-f]{40}$'),
  idempotency_key             text not null check (char_length(idempotency_key) between 8 and 128),
  listing_reference           text not null check (char_length(listing_reference) between 1 and 512),
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  service_registry_address    text not null check (service_registry_address ~ '^0x[0-9a-f]{40}$'),
  listing_id                  numeric(78, 0) not null check (listing_id > 0),
  agent_id                    numeric(78, 0) not null check (agent_id >= 0),
  listing_version             numeric(78, 0) not null check (listing_version > 0),
  method                      text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  input                       jsonb not null,
  input_hash                  text not null check (input_hash ~ '^0x[0-9a-f]{64}$'),
  max_amount_usdc             text not null check (max_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  target_url                  text check (target_url is null or (target_url ~ '^https://' and char_length(target_url) <= 2048)),
  state                       text not null default 'prepared' check (state = 'prepared'),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (actor_address, idempotency_key)
);
create index if not exists agon_x402_call_intents_actor_idx
  on agon_x402_call_intents(actor_address, created_at desc);
alter table agon_x402_call_intents add column if not exists target_url text;
alter table agon_x402_call_intents drop constraint if exists agon_x402_call_intents_target_url_check;
alter table agon_x402_call_intents add constraint agon_x402_call_intents_target_url_check
  check (target_url is null or (target_url ~ '^https://' and char_length(target_url) <= 2048));

-- Durable Circle/x402 receipt boundary. This records evidence and opaque
-- settlement references without storing raw EIP-3009 signatures or keys.
-- A settlement reference is not assumed to be an explorer transaction hash;
-- reconciliation must verify it before a receipt becomes final.
create table if not exists agon_x402_call_receipts (
  receipt_id                uuid primary key,
  intent_id                 uuid not null references agon_x402_call_intents(intent_id),
  state                     text not null check (state in (
    'prepared', 'approved', 'payment_required', 'authorization_submitted',
    'settlement_submitted', 'service_delivered', 'reconciled', 'rejected',
    'failed', 'unknown'
  )),
  approved_amount_usdc      text check (approved_amount_usdc is null or approved_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  quote_hash                text check (quote_hash is null or quote_hash ~ '^0x[0-9a-f]{64}$'),
  quote_snapshot            jsonb,
  authorization_hash        text check (authorization_hash is null or authorization_hash ~ '^0x[0-9a-f]{64}$'),
  settlement_ref             text,
  service_status             int check (service_status is null or service_status between 200 and 299),
  payment_response_hash      text check (payment_response_hash is null or payment_response_hash ~ '^0x[0-9a-f]{64}$'),
  charged_amount_usdc        text check (charged_amount_usdc is null or charged_amount_usdc ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$'),
  failure_code               text,
  failure_message            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (intent_id)
);
create index if not exists agon_x402_call_receipts_state_idx
  on agon_x402_call_receipts(state, updated_at desc);
alter table agon_x402_call_receipts add column if not exists quote_snapshot jsonb;

create table if not exists agon_indexer_state (
  stream_name                 text not null check (char_length(stream_name) > 0),
  chain_id                    numeric(78, 0) not null check (chain_id > 0),
  contract_address            text not null check (contract_address ~ '^0x[0-9a-f]{40}$'),
  last_block                  numeric(78, 0) not null check (last_block >= 0),
  last_block_hash             text not null check (last_block_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at                  timestamptz not null default now(),
  primary key (stream_name, chain_id, contract_address)
);

create or replace function agon_reject_append_only_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_listing_versions_append_only'
      and tgrelid = 'agon_listing_versions'::regclass
  ) then
    create trigger agon_listing_versions_append_only
      before update or delete on agon_listing_versions
      for each row execute function agon_reject_append_only_mutation();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_listing_events_append_only'
      and tgrelid = 'agon_listing_events'::regclass
  ) then
    create trigger agon_listing_events_append_only
      before update or delete on agon_listing_events
      for each row execute function agon_reject_append_only_mutation();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agon_chain_events_append_only'
      and tgrelid = 'agon_chain_events'::regclass
  ) then
    create trigger agon_chain_events_append_only
      before update or delete on agon_chain_events
      for each row execute function agon_reject_append_only_mutation();
  end if;
end;
$$;
