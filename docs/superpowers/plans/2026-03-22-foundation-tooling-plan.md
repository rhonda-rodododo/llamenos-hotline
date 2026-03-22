# Foundation Tooling — Implementation Plan

**Date:** 2026-03-22
**Spec:** docs/superpowers/specs/2026-03-22-foundation-tooling-design.md
**Status:** Ready to implement

---

## Key Findings from Codebase Exploration

1. `docker-compose.dev.yml` already exists at `deploy/docker/docker-compose.dev.yml` but is a standalone file for backing services only — not a compose override. Replace/repurpose as an override.
2. `health.ts` has a local `declare const __BUILD_VERSION__` (line 4) in addition to `globals.d.ts` — both must be removed.
3. `health.ts` has a dynamic import path `../../../src/platform/node/storage/postgres-pool` — correct for bundled output, wrong for running source directly. Must be fixed to `../../platform/node/storage/postgres-pool`.
4. The checksums step in CI checksums both `dist/client` and `dist/server` — after removing server bundle, only `dist/client` exists.
5. `esbuild` devDependency (`"esbuild": "^0.27.3"`) must be removed from `package.json`.
6. Bun natively reads `tsconfig.json` `paths` entries at runtime — `@worker/*`, `@shared/*`, `@/*` aliases work without any extra config.

---

## Phase 1 — Biome Setup (no dependencies)

### Step 1.1 — Add Biome as devDependency

**File:** `package.json`

- Add `"@biomejs/biome": "^1.9.4"` to `devDependencies`
- Add scripts:
  ```json
  "lint": "biome check src/",
  "lint:fix": "biome check --write src/",
  "format": "biome format --write src/"
  ```
- Run `bun install` to update `bun.lockb`

### Step 1.2 — Create `biome.json`

**File:** `biome.json` (repo root, new file)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double"
    }
  },
  "files": {
    "ignore": [
      "dist/",
      "node_modules/",
      "src/client/routeTree.gen.ts",
      "site/"
    ]
  }
}
```

### Step 1.3 — Fix all Biome violations

Run `bun run lint:fix` for auto-fixable issues, then `bun run lint` and manually fix remaining.
Target: `bun run lint` exits 0.

---

## Phase 2 — Build Constants: Replace esbuild `define` with `process.env`

Steps 2.1–2.5 can run in parallel with Phase 3 and 4 after Phase 1 is done.

### Step 2.1 — Delete `src/globals.d.ts`

Remove the file entirely — it only contains the three `declare const` lines for build constants. The `declare const` in `health.ts` line 4 must also be removed in Step 2.4.

### Step 2.2 — Create `src/worker/lib/build-constants.ts`

```typescript
import pkg from '../../../package.json' with { type: 'json' }

export const BUILD_VERSION = process.env.BUILD_VERSION ?? pkg.version
export const BUILD_COMMIT = process.env.BUILD_COMMIT ?? 'dev'
export const BUILD_TIME = process.env.BUILD_TIME ?? new Date().toISOString()
```

Note: Use `with { type: 'json' }` (not `assert`) — Bun supports both but `with` is the current standard.

### Step 2.3 — Update `src/worker/routes/config.ts`

- Add: `import { BUILD_VERSION, BUILD_COMMIT, BUILD_TIME } from '../lib/build-constants'`
- Replace `__BUILD_VERSION__`, `__BUILD_COMMIT__`, `__BUILD_TIME__` with the imported constants.

### Step 2.4 — Update `src/worker/routes/health.ts`

- Remove `declare const __BUILD_VERSION__: string` (line 4)
- Add: `import { BUILD_VERSION } from '../lib/build-constants'`
- Replace `typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev'` with `BUILD_VERSION` (both occurrences — the helper already provides the `'dev'` fallback).

### Step 2.5 — Fix bad import path in `health.ts`

Change the dynamic import from:
```typescript
const { getPool } = await import('../../../src/platform/node/storage/postgres-pool')
```
To:
```typescript
const { getPool } = await import('../../platform/node/storage/postgres-pool')
```

**Verify:** `bun run typecheck` passes after 2.1–2.5.

---

## Phase 3 — `cloudflare:workers` Alias Migration (parallel with Phase 2)

### Step 3.1 — Add `"imports"` field to `package.json`

```json
"imports": {
  "#cloudflare-workers": {
    "bun": "./src/platform/index.ts",
    "default": "./src/platform/index.ts"
  }
}
```

### Step 3.2 — Add TypeScript path alias for `#cloudflare-workers`

**File:** `tsconfig.json` — add to `"paths"`:
```json
"#cloudflare-workers": ["./src/platform/index.ts"]
```

### Step 3.3 — Update all 7 DO source files

In each of these files, change `import { DurableObject } from 'cloudflare:workers'` to `import { DurableObject } from '#cloudflare-workers'`:

- `src/worker/durable-objects/identity-do.ts`
- `src/worker/durable-objects/records-do.ts`
- `src/worker/durable-objects/settings-do.ts`
- `src/worker/durable-objects/shift-manager.ts`
- `src/worker/durable-objects/blast-do.ts`
- `src/worker/durable-objects/call-router.ts`
- `src/worker/durable-objects/conversation-do.ts`

### Step 3.4 — Verify Wrangler build unaffected

Run `bunx wrangler build --dry-run` (or `bun run dev:worker` and confirm it starts). Wrangler resolves `cloudflare:workers` natively — the `package.json` `imports` field is not processed by Wrangler's bundler.

---

## Phase 4 — Remove esbuild: Script Cleanup (parallel with Phases 2 and 3)

### Step 4.1 — Update `package.json` scripts

- **Delete:** `"build:node": "node esbuild.node.mjs"`
- **Delete:** `"build:docker": "bun run build && bun run build:node"`
- **Rename:** `"start:node"` → `"start:bun"`, command: `"bun src/platform/node/server.ts"`
- **Add:**
  ```json
  "dev:docker": "docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml up -d",
  "dev:docker:down": "docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml down"
  ```

### Step 4.2 — Remove `esbuild` devDependency

Remove `"esbuild": "^0.27.3"` from `devDependencies`. Run `bun install`.

### Step 4.3 — Delete `esbuild.node.mjs`

Delete the file entirely.

---

## Phase 5 — Dockerfile Rewrite (depends on Phases 3 + 4)

### Step 5.1 — Rewrite `deploy/docker/Dockerfile`

Replace current 4-stage Node.js Dockerfile with 2-stage Bun Dockerfile:

```dockerfile
# Multi-stage Dockerfile for Llamenos (Bun self-hosted mode)
#
# Bun runs TypeScript natively — no esbuild transpilation step needed.
# Frontend assets (dist/client/) must be built separately before this image.

# ── Stage 1: Production dependencies ──────────────────────
FROM oven/bun:1@sha256:856da45d07aeb62eb38ea3e7f9e1794c0143a4ff63efb00e6c4491b627e2a521 AS deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# ── Stage 2: Runtime ───────────────────────────────────────
# Pin SHA — update via Dependabot or on new minor release
FROM oven/bun:1-slim@sha256:<PIN_CURRENT_SHA>

# Build-time constants (set by CI; safe defaults for local builds)
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=local
ARG BUILD_TIME=1970-01-01T00:00:00Z
ENV BUILD_VERSION=${BUILD_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME} \
    PLATFORM=node \
    PORT=3000 \
    NODE_ENV=production

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r llamenos && useradd -r -g llamenos -d /app -s /sbin/nologin llamenos

WORKDIR /app

# Source + deps
COPY package.json bun.lockb tsconfig.json ./
COPY src/ src/
COPY --from=deps /app/node_modules/ node_modules/

# Frontend build artifact
COPY dist/client/ dist/client/

RUN chown -R llamenos:llamenos /app
USER llamenos

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/api/health/ready || exit 1

CMD ["bun", "src/platform/node/server.ts"]
```

**Action required:** Look up the current digest for `oven/bun:1-slim` on Docker Hub and replace `<PIN_CURRENT_SHA>`.

### Step 5.2 — Update `docker-compose.yml` app service comment

Line 8: `app - Llamenos application (Node.js)` → `app - Llamenos application (Bun)`

### Step 5.3 — Update `docker-compose.yml` build args

In the app service `build:` block, add:
```yaml
build:
  context: ../..
  dockerfile: deploy/docker/Dockerfile
  args:
    BUILD_VERSION: ${BUILD_VERSION:-dev}
    BUILD_COMMIT: ${BUILD_COMMIT:-local}
    BUILD_TIME: ${BUILD_TIME:-1970-01-01T00:00:00Z}
```

### Step 5.4 — Rewrite `deploy/docker/docker-compose.dev.yml` as compose override

```yaml
# Local development port overrides — avoids conflicts with llamenos v2 (~/projects/llamenos)
#
# v2 uses: postgres:5432, minio:9000/9001, strfry:7777, api:3000
# v1 uses: postgres:5433, minio:9002/9003, strfry:7778, wrangler:8788 (no conflict)
#
# Usage: bun run dev:docker
# (runs: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d)

services:
  postgres:
    ports:
      - "5433:5432"
  minio:
    ports:
      - "9002:9000"
      - "9003:9001"
  strfry:
    ports:
      - "7778:7777"
```

### Step 5.5 — Update `Dockerfile.build` (reproducible builds)

Remove the esbuild step:
```dockerfile
# DELETE THIS LINE:
RUN node esbuild.node.mjs
```
Output is now `dist/client/` only (Vite output). Server source is copied directly in the runtime Dockerfile.

---

## Phase 6 — CI Updates (step 6.1 after Phase 1; steps 6.3–6.5 after Phase 4)

### Step 6.1 — Add `lint` job to `ci.yml`

Add after `changes` job, before `build`:

```yaml
  # ─── Lint ─────────────────────────────────────────────────
  lint:
    needs: changes
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Setup Bun
        uses: oven-sh/setup-bun@4bc047ad259df6fc24a6c9b0f9a0cb08cf17fbe5 # v2.0.2
        with:
          bun-version: ${{ env.BUN_VERSION }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Lint
        run: bunx biome check src/
```

### Step 6.2 — Gate `build` on `lint`

```yaml
build:
  needs: [changes, lint]
```

### Step 6.3 — Remove `build:node` step from `build` job

Remove:
```yaml
      - name: Build Node.js server
        run: bun run build:node
```

### Step 6.4 — Fix checksums step

Change `find client server -type f` → `find client -type f` (server bundle no longer exists).

### Step 6.5 — Add BUILD_* env vars to E2E jobs

In the `e2e` job's step that creates `.env`, add:
```bash
BUILD_VERSION=$(node -e "process.stdout.write(require('./package.json').version)")
BUILD_COMMIT=${GITHUB_SHA}
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

### Step 6.6 — Update `ci.yml` header comment

Line referencing `esbuild`: change to `# 2. Build & validate (lint, typecheck, vite build, site build)`

---

## Phase 7 — CLAUDE.md Updates (independent, any time)

### Step 7.1 — Update CLAUDE.md

- **Tech Stack**: Change runtime from Node.js to Bun; CF Workers is demo-only
- **Deployment**: Primary is Docker + Ansible (VPS); CF Workers is optional demo
- **Development Commands**: Add `lint`, `lint:fix`, `dev:docker`, `dev:docker:down`, `start:bun`; remove `build:node`, `start:node`, `build:docker`
- **Add port offset table** under a new "Local Dev Port Offsets" section
- **Deployment rules**: Update to reference `deploy:cloudflare` not `deploy:demo`

---

## Phase 8 — Final Verification

1. `bun install` — clean lockfile, no esbuild
2. `bun run typecheck` — zero errors
3. `bun run lint` — zero errors
4. `bun run build` — Vite build succeeds, no server bundle step
5. `bun run start:bun` (with Docker services via `bun run dev:docker`) — server starts, `curl http://localhost:3000/api/health/ready` returns ok
6. Docker image builds:
   ```bash
   bun run build  # must run first — produces dist/client/
   docker build --build-arg BUILD_VERSION=0.20.0 --build-arg BUILD_COMMIT=local -f deploy/docker/Dockerfile -t llamenos:test .
   docker run --rm -p 3001:3000 ... llamenos:test
   curl http://localhost:3001/api/health/ready
   ```
7. `bunx playwright test` — all tests pass

---

## Parallel Execution Map

```
Phase 1 (Biome) → required first
    ↓
Phase 2 ──────────────────────────┐
Phase 3 ──────────────────────────┤ all parallel after Phase 1
Phase 4 ──────────────────────────┘
Phase 7 (CLAUDE.md) ──────────────┘ (fully independent)
    ↓ (after Phases 3 + 4)
Phase 5 (Dockerfile)
    ↓ (after Phase 4)
Phase 6 (CI)
    ↓
Phase 8 (Verification)
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `biome.json` | Create |
| `package.json` | Modify (scripts, deps, imports field) |
| `tsconfig.json` | Modify (add #cloudflare-workers path) |
| `src/globals.d.ts` | Delete |
| `src/worker/lib/build-constants.ts` | Create |
| `src/worker/routes/config.ts` | Modify |
| `src/worker/routes/health.ts` | Modify |
| `src/worker/durable-objects/*.ts` (7 files) | Modify (import alias) |
| `esbuild.node.mjs` | Delete |
| `deploy/docker/Dockerfile` | Rewrite (4-stage → 2-stage Bun) |
| `deploy/docker/Dockerfile.build` | Modify (remove esbuild step) |
| `deploy/docker/docker-compose.yml` | Modify (comment + build args) |
| `deploy/docker/docker-compose.dev.yml` | Rewrite (port override only) |
| `.github/workflows/ci.yml` | Modify (lint job, remove build:node, fix checksums) |
| `CLAUDE.md` | Modify |
