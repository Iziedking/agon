# Backend image (indexer / auth / coordinator / migrate). Build context is the
# backend folder; the deployments file is mounted in by compose, not copied.
FROM node:20-slim

WORKDIR /app/backend

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install

# Backend source (node_modules and .env are excluded by .dockerignore).
COPY . ./

# The command (indexer / auth / coordinator / migrate) is set per service in compose.
# config/index.ts reads ../contracts/deployments/arc-testnet.json, which compose
# mounts at /app/contracts/deployments.
