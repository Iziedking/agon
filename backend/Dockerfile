# Backend image (indexer / auth / coordinator / migrate). Build context is the
# backend folder; the deployments file is mounted in by compose, not copied.
FROM node:20-slim

WORKDIR /app/backend

# Install deps first for layer caching.
# Use `npm ci`, not `npm install`: ci installs the EXACT versions pinned in
# package-lock.json and never re-resolves ranges. `npm install` does re-resolve,
# so with the Circle SDKs pinned as "latest"/"^" (app-kit, swap-kit,
# adapter-viem-v2, provider-stablecoin-service-swap) every rebuild could pull a
# newer Circle release — and one of those silently broke the Arc swap route,
# reverting every Scout swap. ci keeps the lockfile's known-good versions.
COPY package.json package-lock.json* ./
RUN npm ci

# Backend source (node_modules and .env are excluded by .dockerignore).
COPY . ./

# The command (indexer / auth / coordinator / migrate) is set per service in compose.
# config/index.ts reads ../contracts/deployments/arc-testnet.json, which compose
# mounts at /app/contracts/deployments.
