# Production Dockerfile for apps/web — used for self-hosted deployments.
# Build from the monorepo root so pnpm workspace files are included:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
#     -t ghcr.io/<owner>/spanlens-web .
#
# Runtime: node:22-alpine serving Next.js standalone on PORT (default 3000).
# Env vars required at runtime (see apps/web/.env.example):
#   NEXT_PUBLIC_SUPABASE_URL   (also needed as build arg — baked into client bundle)
#   NEXT_PUBLIC_SUPABASE_ANON_KEY  (same)
#   SUPABASE_SERVICE_ROLE_KEY  (server-side only, for middleware workspace resolution)
#   API_URL                    (backend server URL, e.g. http://server:3001)

# ── Stage 1: deps ───────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace manifests so pnpm can resolve the workspace graph.
# apps/server and packages/sdk manifests are needed because they are
# declared in pnpm-workspace.yaml, even though web doesn't import them.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/sdk/package.json ./packages/sdk/

RUN pnpm install --frozen-lockfile --filter web

# ── Stage 2: build ──────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# NEXT_PUBLIC_* vars are statically inlined into the client bundle at build
# time by Next.js — they must be present as build ARGs, not just runtime env.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# API_URL default matches the docker-compose service name "server".
ARG API_URL=http://server:3001

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV API_URL=$API_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules

# Copy workspace manifests (needed for pnpm exec)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web
COPY apps/server/package.json ./apps/server/
COPY packages/sdk/package.json ./packages/sdk/
COPY tsconfig*.json ./

RUN pnpm --filter web build

# ── Stage 3: runner ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js standalone server listens on PORT; HOSTNAME=0.0.0.0 required
# inside Docker so the server accepts connections from outside the container.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Standalone output is a self-contained server with traced node_modules.
# The directory structure mirrors the monorepo layout:
#   .next/standalone/apps/web/server.js  ← entry point
#   .next/standalone/apps/web/.next/     ← compiled pages
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
# Static assets are NOT included in standalone and must be copied separately.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget --quiet --spider http://localhost:3000/ || exit 1

CMD ["node", "apps/web/server.js"]
