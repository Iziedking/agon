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
  current_syndicate_id bigint,
  reputation           numeric not null default 0,
  cycles               numeric not null default 0,
  created_at           timestamptz not null default now()
);
-- Add cycles to operators tables created before this column existed.
alter table operators add column if not exists cycles numeric not null default 0;

create table if not exists agents (
  id               bigint primary key,
  owner            text not null,
  erc8004_token_id numeric,
  scout_tier       int not null default 0,
  analyst_tier     int not null default 0,
  solver_tier      int not null default 0,
  reputation       numeric not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists agents_owner_idx on agents(owner);

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
-- claim. The 24h cooldown is enforced by the auth service.
create table if not exists mystery_claims (
  operator     text primary key,
  last_claim   timestamptz not null,
  total_claims bigint not null default 0
);
