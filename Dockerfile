# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────
# Stage 1: build
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN pnpm install --frozen-lockfile=false

# Copy the rest of the source.
COPY shared ./shared
COPY server ./server
COPY client ./client

# Build shared (composite tsc emits to shared/dist), then client, then server.
RUN pnpm -F @uno/shared build \
 && pnpm -F @uno/client build \
 && pnpm -F @uno/server build

# Prune dev deps for the runtime image (keeps server prod deps available).
# pnpm v10 requires --legacy unless inject-workspace-packages is enabled.
RUN pnpm -F @uno/server deploy --prod --legacy /deploy/server

# ─────────────────────────────────────────────────────────────
# Stage 2: runtime
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Layout chosen so server/dist/index.js resolves client at ../../client/dist:
#   /app/server/dist/index.js -> /app/server -> /app -> /app/client/dist ✓
COPY --from=build /deploy/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3000
CMD ["node", "server/dist/index.js"]
