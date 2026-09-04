#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/agon-deploy. CI sends only a SHA.
# No git reset, on-host build, orphan deletion, volume deletion or image prune.
set -euo pipefail
umask 077
sha="${1:-}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Expected a full commit SHA" >&2; exit 1; }
exec 9>/run/lock/agon-release.lock
flock -n 9 || { echo "An AGON release is already running" >&2; exit 1; }
incoming="/opt/agon-ci/incoming/$sha"
release="/opt/agon-releases/$sha"
test -f "$incoming/images.tar.gz"
test -f /opt/arcrun/deploy/bnb.env
test -f /opt/arcrun/deploy/.env
mkdir -p "$release"
cd "$incoming"
sha256sum --check SHA256SUMS
cp /etc/agon/release.compose.yml "$release/compose.yml"
cp Caddyfile "$release/Caddyfile"
cp -R contracts "$release/"
gzip -dc images.tar.gz | docker load >/dev/null
export AGON_RELEASE_SHA="$sha"
compose=(docker compose -p deploy --env-file /opt/arcrun/deploy/.env -f "$release/compose.yml")
"${compose[@]}" config --quiet
docker run --rm --network deploy_default -v "$release/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile >/dev/null
cp -p /opt/arcrun/deploy/caddy/Caddyfile "$release/Caddyfile.previous"
mkdir -p /opt/arcrun/backups
docker exec arcrun-postgres pg_dump -U arcrun -Fc arcrun > "/opt/arcrun/backups/pre-release-arc-$sha.dump"
docker exec arcrun-postgres pg_dump -U arcrun -Fc agon_bnb > "/opt/arcrun/backups/pre-release-bnb-$sha.dump"
previous="$(readlink -f /opt/agon-releases/current || true)"
previous_bnb_image="$(docker inspect --format '{{.Image}}' agon-bnb-api 2>/dev/null || true)"
rollback() {
  echo "Release failed; restoring previous service images and ingress." >&2
  cp -p "$release/Caddyfile.previous" /opt/arcrun/deploy/caddy/Caddyfile
  docker exec arcrun-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null || true
  if [ -n "$previous" ] && [ -f "$previous/compose.yml" ]; then
    export AGON_RELEASE_SHA="$(basename "$previous")"
    docker compose -p deploy --env-file /opt/arcrun/deploy/.env -f "$previous/compose.yml" up -d --no-deps --wait --wait-timeout 120 auth indexer coordinator bnb-api || true
  else
    docker compose -p deploy --env-file /opt/arcrun/deploy/.env -f /opt/arcrun/deploy/docker-compose.yml up -d --no-deps auth indexer coordinator || true
    if [ -n "$previous_bnb_image" ]; then
      docker tag "$previous_bnb_image" agon-bnb-api:bootstrap-rollback
      AGON_RELEASE_SHA=bootstrap-rollback docker compose -p deploy --env-file /opt/arcrun/deploy/.env -f /etc/agon/release.compose.yml up -d --no-deps --wait --wait-timeout 120 bnb-api || true
    fi
  fi
  echo "Backups retained; database schema rollback is never automatic." >&2
}
trap rollback ERR
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" up -d --no-deps --wait --wait-timeout 120 auth indexer coordinator bnb-api
cp "$release/Caddyfile" /opt/arcrun/deploy/caddy/Caddyfile
docker exec arcrun-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
for chain in 56 97; do
  curl --fail --silent --show-error --max-time 30 "https://api.agon.surf/api/bnb/$chain/health" |
    python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["storage"]=="reachable" and x["rpc"]=="reachable" and x["login"]=="available"; print("BNB",x["chainId"],"ready")'
done
curl --fail --silent --show-error --max-time 30 https://api.agon.surf/agon/health |
  python3 -c 'import json,sys; x=json.load(sys.stdin); assert x["ok"] and x["service"]=="agon"; print("Arc AGON ready")'
ln -sfn "$release" /opt/agon-releases/current
trap - ERR
echo "AGON release $sha healthy. Payment and settlement gates unchanged."
