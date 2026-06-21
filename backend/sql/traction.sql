-- ArcRun traction metrics (P0 of the hardening punch list).
--
-- Answers the one number Agora and Circle care about: how many REAL human
-- operators, with their own wallets, claimed an agent and entered an event,
-- and how much USDC real operators moved versus the platform.
--
-- WHY a heuristic and not just an address blocklist: the schema has no
-- is_platform flag (operators/agents/entries/challenge_entries all lack one),
-- and the autopilot funds Scout execution from hot wallets derived off
-- SCOUT_MASTER_MNEMONIC that NEVER appear as operators. So an operators row is
-- already almost always a real person. We tighten it two ways:
--   1) exclude the known platform wallets (coordinator, treasury), and
--   2) flag operators that carry a human identity (email, Circle wallet, a
--      linked X/Discord/Telegram, or a passkey) so a sharp reviewer can see
--      the clearly-human count separately from bare SIWE wallets.
--
-- HOW TO RUN: fill the platform_addr CTE with your coordinator and treasury
-- addresses (lowercased), derived from COORDINATOR_PRIVATE_KEY and
-- TREASURY_PRIVATE_KEY, then `psql "$DATABASE_URL" -f backend/sql/traction.sql`.

-- ---------------------------------------------------------------------------
-- Reusable classification view. Labels every operator: platform vs not,
-- human-identity-linked vs bare wallet, and whether they entered any event.
-- ---------------------------------------------------------------------------
create or replace view v_operator_classification as
with platform_addr(address) as (
  -- FILL THESE IN (lowercased). Add more rows if you run other platform wallets.
  values
    ('0x4d61c5b8b100603dd578a99acb5160fcf0b44f75'), -- coordinator
    ('0xae410741d2b6785cd52eae02d4f617f396a06bb2')  -- treasury
),
ent as (
  select operator from entries
  union
  select operator from challenge_entries
)
select
  o.address,
  (lower(o.address) in (select address from platform_addr)) as is_platform,
  (o.email is not null
    or o.circle_wallet_id is not null
    or o.x_handle is not null
    or o.discord_id is not null
    or o.telegram_id is not null
    or exists (select 1 from webauthn_credentials w
                where lower(w.operator_address) = lower(o.address))
  ) as has_human_identity,
  exists (select 1 from ent e where lower(e.operator) = lower(o.address)) as entered_event
from operators o;

-- ---------------------------------------------------------------------------
-- Headline summary: the numbers to quote in the submission.
-- ---------------------------------------------------------------------------
-- "Real operator" = not a platform wallet. "Clearly human" additionally
-- carries an email / Circle wallet / social link / passkey.
select
  count(*) filter (where not is_platform)                                as real_operators,
  count(*) filter (where not is_platform and has_human_identity)         as clearly_human_operators,
  count(*) filter (where not is_platform and entered_event)              as real_operators_who_entered,
  count(*) filter (where not is_platform and has_human_identity
                          and entered_event)                            as clearly_human_who_entered
from v_operator_classification;

-- ---------------------------------------------------------------------------
-- Human-funded campaigns: contests whose sponsor is a real (non-platform)
-- operator. This is the "someone paid a listing fee from their own wallet"
-- signal the punch list asks for.
-- ---------------------------------------------------------------------------
select
  count(*)                              as human_funded_contests,
  count(distinct c.sponsor)             as distinct_human_sponsors,
  coalesce(sum(c.prize_pool), 0)        as total_human_funded_pool
from contests c
where c.sponsor is not null
  and lower(c.sponsor) not in (select address from (
        select '0x4d61c5b8b100603dd578a99acb5160fcf0b44f75' as address  -- coordinator
        union all select '0xae410741d2b6785cd52eae02d4f617f396a06bb2'   -- treasury
  ) p);

-- ---------------------------------------------------------------------------
-- USDC moved to real operators vs platform. treasury_flow records on-chain
-- escrow payouts/fees (recipient, amount). Real = recipient is not a platform
-- wallet. This is a floor for "real economic value reaching real users".
-- ---------------------------------------------------------------------------
select
  coalesce(sum(amount) filter (where lower(recipient) not in (
      '0x4d61c5b8b100603dd578a99acb5160fcf0b44f75',  -- coordinator
      '0xae410741d2b6785cd52eae02d4f617f396a06bb2'   -- treasury
  )), 0)                                                          as usdc_to_real_operators,
  coalesce(sum(amount) filter (where lower(recipient) in (
      '0x4d61c5b8b100603dd578a99acb5160fcf0b44f75',
      '0xae410741d2b6785cd52eae02d4f617f396a06bb2'
  )), 0)                                                          as usdc_to_platform
from treasury_flow;

-- ---------------------------------------------------------------------------
-- Roster of the clearly-human operators who entered, for a sanity eyeball.
-- ---------------------------------------------------------------------------
select address from v_operator_classification
where not is_platform and has_human_identity and entered_event
order by address;
