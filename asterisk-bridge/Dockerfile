FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS base
WORKDIR /app

# Install dependencies
COPY asterisk-bridge/package.json asterisk-bridge/bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# Copy source code
COPY asterisk-bridge/src/ src/
COPY asterisk-bridge/tsconfig.json ./

# Type check
RUN bun run typecheck

# Build
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521
WORKDIR /app

COPY --from=base /app/dist/ dist/
COPY --from=base /app/package.json ./

# Environment variables (set at runtime)
ENV ARI_URL=ws://asterisk:8088/ari/events
ENV ARI_REST_URL=http://asterisk:8088/ari
ENV ARI_USERNAME=llamenos
# ARI_PASSWORD must be set at runtime — no default (CWE-798)
ENV WORKER_WEBHOOK_URL=https://your-worker.example.com
# BRIDGE_SECRET must be set at runtime — no default
ENV BRIDGE_PORT=3000
ENV BRIDGE_BIND=0.0.0.0
ENV STASIS_APP=llamenos

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
