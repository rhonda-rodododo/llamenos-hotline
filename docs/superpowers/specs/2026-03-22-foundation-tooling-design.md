# Foundation Tooling — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Establish the baseline developer tooling for v1 (llamenos-hotline): linting, formatting, Bun-native runtime (replacing Node.js + esbuild), local dev port offsets to avoid conflicts with v2 (~/projects/llamenos), and updated documentation reflecting current deployment reality.

---

## 1. Linting & Formatting — Biome

### What

Add [Biome](https://biomejs.dev/) as the single tool for both linting and formatting. No ESLint, no Prettier — Biome replaces both.

### Why

- Native Bun project; Biome is the fastest choice with zero config overhead
- One tool instead of two reduces friction
- Already used in many Bun/Vite projects; well-supported

### Config

Add `biome.json` at repo root with:
- `formatter.enabled: true`, `indentStyle: "space"`, `indentWidth: 2`
- `linter.enabled: true`, recommended rules enabled
- `javascript.formatter.quoteStyle: "double"`
- Ignore: `dist/`, `node_modules/`, `src/client/routeTree.gen.ts`, `site/`

Add scripts to `package.json`:
```json
"lint": "biome check src/",
"lint:fix": "biome check --write src/",
"format": "biome format --write src/"
```

Add `biome check src/` as a CI job (`lint`) that runs after install, before build, and gates the build job. Fix all existing violations as part of this workstream.

---

## 2. Bun Runtime — Replace Node.js + esbuild

### What

Replace the esbuild-based Node.js build pipeline with Bun running TypeScript natively. Mirror v2's approach exactly.

### Current state

- `esbuild.node.mjs` bundles `src/platform/node/server.ts` → `dist/server/index.js` targeting Node.js
- `Dockerfile` (in `deploy/docker/`) uses a Node.js base image and runs `node dist/server/index.js`
- The esbuild config handles the critical `cloudflare:workers` alias: it maps the CF virtual module to `src/platform/index.ts` (the PostgreSQL DO shim)

### Target state

- `deploy/docker/Dockerfile` uses `oven/bun:1-slim` (pinned SHA, updated via Dependabot)
- No esbuild bundling step — Bun runs source TypeScript directly
- Server entry: `bun src/platform/node/server.ts`
- `esbuild.node.mjs` deleted; `build:node` script removed from `package.json`

### The `cloudflare:workers` alias problem

The `cloudflare:workers` virtual module import is used in all DO files. esbuild currently rewrites it to our shim at bundle time. With Bun, we solve this using **package.json `imports` field** (Node.js subpath imports, supported by Bun):

```json
{
  "imports": {
    "#cloudflare-workers": {
      "bun": "./src/platform/index.ts",
      "default": "./src/platform/index.ts"
    }
  }
}
```

Then update all DO source files to import from `#cloudflare-workers` instead of `cloudflare:workers`. This is a mechanical find-and-replace. The CF Worker build (wrangler) continues to resolve `cloudflare:workers` natively via Wrangler — the `imports` field only applies when running under Bun/Node.js.

### TypeScript path aliases (@worker/*, @shared/*, @/*)

Bun natively reads `tsconfig.json` `paths` entries at runtime, so the `@worker/*`, `@shared/*`, and `@/*` aliases defined in `tsconfig.json` work without any additional config. No esbuild plugin or manual resolution is required. This is a non-issue but worth stating explicitly.

### Build-time constants (__BUILD_TIME__, __BUILD_COMMIT__, __BUILD_VERSION__)

The server code (`src/worker/routes/config.ts`, `src/worker/routes/health.ts`) uses three globals currently injected by esbuild's `define` at bundle time. When esbuild is removed, these must be replaced with environment variables read at runtime:

- `__BUILD_VERSION__` → `process.env.BUILD_VERSION ?? pkg.version`
- `__BUILD_COMMIT__` → `process.env.BUILD_COMMIT ?? 'dev'`
- `__BUILD_TIME__` → `process.env.BUILD_TIME ?? new Date().toISOString()`

Remove the `declare const` entries from `src/globals.d.ts`. Update callers to use `process.env.*` directly (or a small helper). The Dockerfile and CI set these as `ENV`/`ARG` build-time values:

```dockerfile
ARG BUILD_VERSION=dev
ARG BUILD_COMMIT=local
ARG BUILD_TIME=1970-01-01T00:00:00Z
ENV BUILD_VERSION=${BUILD_VERSION} BUILD_COMMIT=${BUILD_COMMIT} BUILD_TIME=${BUILD_TIME}
```

CI passes `--build-arg BUILD_VERSION=$(cat package.json | jq -r .version) --build-arg BUILD_COMMIT=$GITHUB_SHA --build-arg BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)`.

### Dockerfile changes

The current `deploy/docker/Dockerfile` has four stages. Migrating to Bun collapses it to two:

- **Eliminated:** the esbuild backend build stage (`RUN node esbuild.node.mjs`) and the Node.js runtime stage
- **Kept:** the deps install stage and the slim runtime stage

```
Stage 1: oven/bun:1 (pinned SHA) — install production deps (bun install --production)
Stage 2: oven/bun:1-slim (pinned SHA) — copy src + node_modules, build args for constants, run as non-root
CMD ["bun", "src/platform/node/server.ts"]
```

Copy pattern: copy `src/`, `package.json`, `bun.lockb`, `tsconfig.json`, `node_modules/` — no build artifacts needed.

### `docker-compose.yml` comment update

Remove "Node.js" from app service comment; update to "Bun".

### `start:node` script

Rename to `start:bun`, change command to `bun src/platform/node/server.ts`. Update any documentation references.

### `build:docker` script

The `build:docker` script previously ran `bun run build && bun run build:node` (Vite frontend + esbuild server bundle). With the server running source directly, the Docker image no longer needs a pre-built server bundle. **Delete `build:docker`** — the Docker build stage handles everything. Update any CI references (currently `ci.yml:125` runs `bun run build:node`; remove that step).

### `build:node` script and `esbuild.node.mjs`

Delete both. Remove the `esbuild` devDependency from `package.json`.

### Reproducible builds (Dockerfile.build)

`Dockerfile.build` already uses `oven/bun:1` for the Vite frontend build. Remove the esbuild step (`RUN node esbuild.node.mjs`). The output is now just `dist/client/` (Vite output). Server source is copied directly in the runtime Dockerfile.

---

## 3. Local Dev Port Offsets

### Problem

v2 (~/projects/llamenos) exposes these ports in its dev compose:

| Service | v2 port |
|---|---|
| PostgreSQL | 5432 |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| strfry (Nostr) | 7777 |
| API | 3000 |

v1 must not conflict when both projects run simultaneously.

### Solution

Add `deploy/docker/docker-compose.dev.yml` — a compose override for local development that remaps host ports only. Production ports remain unchanged (internal network only).

```yaml
# deploy/docker/docker-compose.dev.yml
# Local dev port overrides — avoids conflicts with llamenos v2 (~/projects/llamenos)
# Usage: docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

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

App (wrangler dev) runs at port `8788` — no conflict with v2's `3000`.

Add convenience scripts to `package.json`:
```json
"dev:docker": "docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml up -d",
"dev:docker:down": "docker compose -f deploy/docker/docker-compose.yml -f deploy/docker/docker-compose.dev.yml down"
```

---

## 4. CLAUDE.md Updates

Update `CLAUDE.md` to reflect current reality:

- **Primary deployment**: Docker + Ansible (VPS). Not Cloudflare.
- **Demo deployment**: `bun run deploy:demo` → CF Workers (demo only, optional)
- **Runtime**: Bun (not Node.js). CF Workers for demo only.
- **Local dev ports**: Document the port offset table and `dev:docker` script
- **Biome**: Add `bun run lint` and `bun run lint:fix` to dev workflow
- **Concurrent dev**: Note that v2 (~/projects/llamenos) runs at port 3000; use `dev:docker` for v1 to avoid conflicts
- **Remove**: References to `build:node`, `start:node` scripts after they're renamed
- **Deployment rules**: Update to reflect ansible as primary, CF as optional demo target

---

## 5. CI Changes

Add `lint` job to `.github/workflows/ci.yml`:
```yaml
lint:
  needs: changes
  runs-on: ubuntu-latest
  steps:
    - checkout, setup bun, install deps
    - run: bunx biome check src/
```

The `lint` job gates the `build` job (build must wait for lint to pass).

---

## Testing

- `bun run lint` — zero errors
- `bun run build:docker` (now just `bun run build`) — succeeds
- `docker compose ... up` with Bun image — health check passes
- `bunx playwright test` against Docker Compose backend — passes

## Out of Scope

- Biome autofix for existing code style (just fix lint errors, don't enforce new style on untouched files)
- Switching CF Workers demo to Bun (CF Workers uses its own runtime)
- Any application feature changes
