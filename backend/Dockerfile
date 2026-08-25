# Backend image (indexer / auth / coordinator / migrate). Build context is the
# backend folder; the deployments file is mounted in by compose, not copied.
FROM node:22-slim

WORKDIR /app/backend

# Install deps first for layer caching.
# `npm install` (NOT `npm ci`): the committed package-lock.json is not perfectly
# in sync with package.json (a transitive optional dep, utf-8-validate, is absent
# from the lock), and npm ci hard-fails on any drift. The thing npm ci was meant
# to prevent — a rebuild silently pulling a newer Circle SDK that breaks the Arc
# swap route — is instead solved by pinning every @circle-fin/* package to an
# EXACT version in package.json (no "latest"/"^"), so npm install resolves them
# deterministically without needing a perfectly-synced lockfile.
COPY package.json package-lock.json* ./
RUN npm install

# Backend source (node_modules and .env are excluded by .dockerignore).
COPY . ./

# The command (indexer / auth / coordinator / migrate) is set per service in compose.
# config/index.ts reads ../contracts/deployments/arc-testnet.json, which compose
# mounts at /app/contracts/deployments.
