# Production Dockerfile for apps/server — used for self-hosted deployments.
# Build from the monorepo root so pnpm workspace files are included:
#   docker build -f apps/server/Dockerfile -t ghcr.io/<owner>/spanlens-server .
#
# Runtime: node:22-alpine serving Hono on PORT (default 3001).
# Env vars required at runtime (see apps/server/.env.example):
#   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#   ENCRYPTION_KEY (32-byte base64)
#   PADDLE_API_KEY, PADDLE_NOTIFICATION_SECRET, PADDLE_ENVIRONMENT
#   PADDLE_PRICE_STARTER, PADDLE_PRICE_TEAM, PADDLE_PRICE_ENTERPRISE
#   CRON_SECRET

# ── Stage 1: build ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy ALL workspace manifests so pnpm can resolve the workspace graph
# (without these, pnpm --filter fails because apps/web is declared in
# pnpm-workspace.yaml but its package.json is missing from context).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/sdk/package.json ./packages/sdk/

# Install server's deps + its transitive workspace deps (if any)
RUN pnpm install --frozen-lockfile --filter server

# Copy sources needed to build the server
COPY tsconfig*.json ./
COPY apps/server ./apps/server

# Compile TypeScript → dist/
WORKDIR /repo/apps/server
RUN pnpm exec tsc --project tsconfig.json

# ── Stage 2: runtime ────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Need wget for the healthcheck (alpine base doesn't have curl)
RUN apk add --no-cache wget

# Same workspace manifests for production install
COPY --from=builder /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=builder /repo/apps/server/package.json ./apps/server/
COPY --from=builder /repo/apps/web/package.json ./apps/web/
COPY --from=builder /repo/packages/sdk/package.json ./packages/sdk/

# Production-only install — excludes tsc, vitest, eslint, etc.
RUN pnpm install --frozen-lockfile --prod --filter server

# Compiled output from the builder stage
COPY --from=builder /repo/apps/server/dist ./apps/server/dist

# Non-root user for runtime security
RUN addgroup -g 1001 -S nodejs && adduser -S spanlens -u 1001 -G nodejs
USER spanlens

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Container-level healthcheck — /health route already exists in Hono app
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost:3001/health || exit 1

CMD ["node", "apps/server/dist/index.js"]
