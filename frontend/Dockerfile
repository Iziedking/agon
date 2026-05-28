# Frontend image: a production Next.js build served with `next start`.
# NEXT_PUBLIC_* values are inlined at build time and used by the browser, so the
# auth and socket URLs point at the host ports compose maps.
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install
COPY . ./

ENV NEXT_PUBLIC_AUTH_URL=http://localhost:8082
ENV NEXT_PUBLIC_WS_URL=ws://localhost:8788

RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
EXPOSE 3000
CMD ["npm", "run", "start"]
