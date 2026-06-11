#!/usr/bin/env bash
# Set the contest listing fee on ContestEngine from the admin wallet.
#
# The listing fee is a PERCENTAGE of each campaign's prize pool, charged up
# front to the treasury (separate from the 5% settlement skim). It is 0%
# by default (free hosting). Bigger pools pay more. Admin-only: the key you
# pass must hold DEFAULT_ADMIN_ROLE (the deploy admin). Capped at 10%.
#
# Usage:
#   ADMIN_PRIVATE_KEY=0x... ./scripts/set-listing-fee.sh <percent>
#
# Examples:
#   ADMIN_PRIVATE_KEY=0x... ./scripts/set-listing-fee.sh 1.5   # 1.5% of pool
#   ADMIN_PRIVATE_KEY=0x... ./scripts/set-listing-fee.sh 0     # back to free
#
# Optional env:
#   RPC_URL          defaults to Arc testnet
#   ENGINE_ADDRESS   override; otherwise read from the deployments file
set -euo pipefail

RPC_URL="${RPC_URL:-https://rpc.testnet.arc.network}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENTS="$HERE/../deployments/arc-testnet.json"

if [ -z "${ADMIN_PRIVATE_KEY:-}" ]; then
  echo "error: set ADMIN_PRIVATE_KEY (the wallet holding DEFAULT_ADMIN_ROLE)" >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "usage: ADMIN_PRIVATE_KEY=0x... $0 <percent>   (e.g. 1.5 for 1.5%)" >&2
  exit 1
fi

PERCENT="$1"
# Convert a percentage (supports one decimal, e.g. 1.5) to basis points.
# 1 bp = 0.01%, so bps = percent * 100. Reject anything that isn't a clean
# integer bps in [0, 1000] (the contract caps listing fee at 10%).
BPS="$(awk -v p="$PERCENT" 'BEGIN { v = p * 100; r = int(v + 0.5); if (v == r) print r; else print "INVALID" }')"
if [ "$BPS" = "INVALID" ]; then
  echo "error: percent must resolve to whole basis points (e.g. 1.5 -> 150). Got '$PERCENT'." >&2
  exit 1
fi
if [ "$BPS" -lt 0 ] || [ "$BPS" -gt 1000 ]; then
  echo "error: listing fee must be 0%..10% (0..1000 bps). Got ${BPS} bps." >&2
  exit 1
fi

ENGINE="${ENGINE_ADDRESS:-}"
if [ -z "$ENGINE" ]; then
  ENGINE="$(grep -o '"ContestEngine"[[:space:]]*:[[:space:]]*"0x[0-9a-fA-F]\{40\}"' "$DEPLOYMENTS" | grep -o '0x[0-9a-fA-F]\{40\}')"
fi
if [ -z "$ENGINE" ]; then
  echo "error: could not resolve ContestEngine address (set ENGINE_ADDRESS)" >&2
  exit 1
fi

echo "ContestEngine: $ENGINE"
echo "Setting listing fee to ${PERCENT}% (${BPS} bps) ..."

cast send "$ENGINE" "setListingFeeBps(uint16)" "$BPS" \
  --rpc-url "$RPC_URL" \
  --private-key "$ADMIN_PRIVATE_KEY"

echo "Done. Verify:"
echo "  cast call $ENGINE \"listingFeeBps()(uint16)\" --rpc-url $RPC_URL"
