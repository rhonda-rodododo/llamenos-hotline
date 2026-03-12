# OpenAPI → quicktype Codegen Pipeline Design

**Date**: 2026-03-12
**Status**: Approved
**Depends on**: Epic 305 (OpenAPI spec generation from Zod — in progress)

## Goal

Replace the JSON Schema → quicktype codegen pipeline with Zod → OpenAPI → quicktype. Zod schemas become the single source of truth for the API surface. Generated Swift/Kotlin/TypeScript types provide compile-time breakage detection when the API changes.

## Source of Truth Chain

```
Zod schemas (apps/worker/schemas/)         ← authored by developers
  ↓ hono-openapi middleware
OpenAPI 3.1 spec                           ← auto-generated at server startup (dev mode)
  ↓ written to disk
openapi-snapshot.json                      ← committed to repo (codegen input)
  ↓ bun run codegen
quicktype (existing dependency)
  ↓
Swift Codable structs                      ← gitignored, generated on build
Kotlin @Serializable data classes          ← gitignored, generated on build
TypeScript interfaces                      ← gitignored, generated on build

crypto-labels.json                         ← unchanged, separate pipeline
  ↓ same codegen.ts
TS/Swift/Kotlin constants                  ← gitignored, generated on build
```

## Key Design Decisions

### 1. quicktype over openapi-generator-cli
- quicktype is already a dependency with proven output quality
- OpenAPI 3.1 component schemas ARE JSON Schema draft 2020-12 — quicktype consumes them natively
- No Java runtime dependency (openapi-generator-cli requires Java)
- `codegen.ts` change is minimal: swap file-based schema reading for OpenAPI spec schema extraction

### 2. Snapshot model (not live fetch)
- Server writes `packages/protocol/openapi-snapshot.json` on startup when `ENVIRONMENT=development`
- Snapshot is committed to repo — it's the codegen input (source), not output
- `bun run codegen` reads from the snapshot, never fetches a live server
- Developers restart dev server after Zod schema changes → snapshot updates automatically

### 3. Generated files are gitignored
- `packages/protocol/generated/` is added to `.gitignore`
- `bun run codegen` becomes a build prerequisite for all platforms
- `bun run codegen:check` is removed (nothing committed to compare against)
- CI runs codegen before each platform build

### 4. Types only (not full HTTP clients)
- Generated output is data types for serialization/deserialization
- Each platform keeps its own networking layer (URLSession, Ktor, fetch)
- Value is compile-time breakage when API shapes change, not client generation

## What Gets Retired

- `packages/protocol/schemas/*.json` — 8 JSON Schema files (content now lives in Zod schemas)
- `bun run codegen:check` — no longer needed with gitignored output
- Hand-written model files in `apps/ios/Sources/Models/` (replaced by generated Types.swift + extensions)
- Hand-written model files in `apps/android/.../model/` (replaced by generated Types.kt + extensions)
- API-surface types in `packages/shared/types.ts` that duplicate Zod schemas (keep crypto-only types)

## What Stays

- `packages/protocol/crypto-labels.json` — separate pipeline, not API types
- Crypto label codegen (TS/Swift/Kotlin constants) — works well, no change needed
- quicktype-core dependency — same tool, different input source
- `packages/protocol/tools/codegen.ts` — rewritten to read OpenAPI spec instead of JSON Schema files
- `packages/protocol/generated/` directory structure — same output dirs

## Consumer Migration

### iOS (apps/ios/)
- Import generated `Types.swift` (Codable structs)
- Platform-specific extensions in separate files (not in generated file)
- Remove hand-written model files that overlap with generated types

### Android (apps/android/)
- Import generated `Types.kt` (@Serializable data classes)
- Platform-specific extensions in separate Kotlin files
- Remove hand-written model files that overlap with generated types

### Desktop (src/client/)
- API types come from `z.infer<>` on Zod schemas or generated `types.ts`
- Remove duplicates from `packages/shared/types.ts`
- Keep crypto-only types that aren't part of the API surface

## Pipeline Commands

```bash
# Start dev server (writes openapi-snapshot.json on startup)
bun run dev:node

# Generate types from snapshot (prerequisite for all builds)
bun run codegen

# Platform builds (each depends on codegen)
bun run test:desktop   # codegen → typecheck → build → playwright
bun run test:ios       # codegen → xcodebuild → tests
bun run test:android   # codegen → gradle → tests
```

## Sequencing

1. **Complete Epic 305** — OpenAPI spec generation from Zod via hono-openapi
2. **Add snapshot writer** — server writes openapi-snapshot.json on dev startup
3. **Rewrite codegen.ts** — read from snapshot instead of JSON Schema files
4. **Gitignore generated output** — update .gitignore, remove committed generated files
5. **Update build scripts** — add codegen as prerequisite to all platform builds
6. **Migrate iOS models** — replace hand-written with generated + extensions
7. **Migrate Android models** — replace hand-written with generated + extensions
8. **Migrate desktop types** — deduplicate shared/types.ts
9. **Delete JSON Schema files** — remove packages/protocol/schemas/
10. **Remove codegen:check** — no longer needed
