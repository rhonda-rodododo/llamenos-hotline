# Multi-stage Dockerfile for Llamenos (Node.js self-hosted mode)
#
# Builds:
#   Stage 1: Frontend SPA (vite build)
#   Stage 2: Node.js server (esbuild)
#   Stage 3: Runtime deps (postgres, ws — pure JS, no native modules)
#   Stage 4: Production image

# Stage 1: Build frontend SPA
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS frontend
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY public/ public/
COPY index.html vite.config.ts tsconfig.json ./
COPY tailwind.config.ts* ./
RUN bun run build

# Stage 2: Build Node.js server
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS backend
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY src/ src/
COPY tsconfig.json esbuild.node.mjs ./
RUN node esbuild.node.mjs

# Stage 3: Install runtime deps (pure JS — no native build tools needed)
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Stage 4: Production
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

# Copy built artifacts
COPY --from=frontend /app/dist/client/ dist/client/
COPY --from=backend /app/dist/server/ dist/server/

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
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server/index.js"]
