# Multi-stage Dockerfile for Llamenos (Node.js self-hosted mode)
#
# Builds:
#   Stage 1: Node.js server (esbuild)
#   Stage 2: Runtime deps (postgres, ws — pure JS, no native modules)
#   Stage 3: Production image (API-only — desktop clients connect to this)

# Stage 1: Build Node.js server
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS backend
WORKDIR /app
COPY package.json ./
# Strip workspace references — Docker only builds the server, not the full monorepo
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf-8'));delete p.workspaces;require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN bun install --ignore-scripts
COPY src/ src/
COPY apps/worker/ apps/worker/
COPY packages/shared/ packages/shared/
COPY packages/i18n/ packages/i18n/
COPY tsconfig.json esbuild.node.mjs ./
RUN node esbuild.node.mjs

# Stage 2: Install runtime deps (pure JS — no native build tools needed)
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS deps
WORKDIR /app
COPY package.json ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf-8'));delete p.workspaces;require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN bun install --production --ignore-scripts

# Stage 3: Production
FROM node:22-slim@sha256:5373f1906319b3a1f291da5d102f4ce5c77ccbe29eb637f072b6c7b70443fc36

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r llamenos && useradd -r -g llamenos -d /app -s /sbin/nologin llamenos

WORKDIR /app

# Copy runtime dependencies (postgres, ws — pure JS)
COPY package.json ./
COPY --from=deps /app/node_modules/ node_modules/

# Copy built server
COPY --from=backend /app/dist/server/ dist/server/

# Serve a minimal download page for browsers hitting the root URL
COPY deploy/docker/download-page/ public/

# Set ownership
RUN chown -R llamenos:llamenos /app

# Switch to non-root user
USER llamenos

# Environment defaults
ENV PLATFORM=node \
    PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health/ready || exit 1

CMD ["node", "dist/server/index.js"]
