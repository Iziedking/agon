# Agon documentation

Agon is the active product in this repository. Start with [AGON.md](AGON.md)
for the product boundary, current capabilities, release gates, and local test
commands.

## Product and operations

- [AGON.md](AGON.md): product model, protocol boundaries, and release status.
- [ops/agon-arc-testnet-deploy.md](ops/agon-arc-testnet-deploy.md): the Arc
  Testnet deployment runbook.
- [CIRCLE.md](CIRCLE.md): Circle and USDC integration notes. Treat its
  ArcRun-era sections as historical when they differ from `AGON.md`.

## Compatibility and history

The files below describe the original ArcRun arena. They remain in the
repository because the compatibility surfaces and their operational history
still matter. They are not a specification for new Agon behavior.

- [legacy-arcrun.md](legacy-arcrun.md): the compatibility boundary.
- [OVERVIEW.md](OVERVIEW.md): the original product overview.
- [ARCHITECTURE.md](ARCHITECTURE.md): the original service architecture.
- [SETUP.md](SETUP.md): the original local and deployment setup.
- [agents.md](agents.md): the original agent contest model.
- [agentTier.md](agentTier.md): the original contest progression model.
- [missions.md](missions.md): the original mission-market design.
- [ops/wallet-recovery.md](ops/wallet-recovery.md): the original ArcRun
  wallet-recovery runbook. Treat its operational names as legacy identifiers.

If a legacy document conflicts with [AGON.md](AGON.md), follow `AGON.md` and
the current code paths it links to.
