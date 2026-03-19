# Codegen Pipeline Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate wasted TypeScript codegen output, harden the `$ref` store, automate schema registry discovery, strip `additionalProperties` leakage, fix `JSONAny` proliferation from `z.unknown()`, and add a CI drift-detection gate.
**Architecture:** The pipeline is a single Bun script (`packages/protocol/tools/codegen.ts`) that reads from `schema-registry.ts`, converts Zod schemas to JSON Schema, and feeds them to quicktype-core for Swift and Kotlin output; after this overhaul the registry becomes self-maintaining via a namespace import from `schemas/index.ts`, TypeScript output is eliminated, and a `--check` flag enables CI to fail fast on stale generated files.
**Tech Stack:** Bun, Zod 4 (`toJSONSchema`), quicktype-core, TypeScript, GitHub Actions CI.

---

## Pre-work: Verify baseline

- [ ] Run `bun run codegen` from repo root and confirm it exits 0 and prints the schema count.
- [ ] Note the count: `"Found N schemas from Zod registry"` — record it for comparison after Phase C.
- [ ] Run `grep -c "PurpleOption\|FluffyOption\|TentacledOption" packages/protocol/generated/kotlin/Types.kt` and record the baseline count.

---

### Task 1 (Phase A): Replace `InlineSchemaStore` with `FlatSchemaStore` and strip `additionalProperties`

**Files:**
- Modify: `packages/protocol/tools/codegen.ts`

**Context:** `InlineSchemaStore.fetch()` currently returns `undefined` for any `$ref` address, which would silently produce mangled names like `Schema0`/`Schema1` if any schema ever introduces a `$ref`. `FlatSchemaStore` builds a lookup map from all registered schemas so `$ref` resolution is correct. Additionally, `z.looseObject()` serializes to `"additionalProperties": {}` which quicktype uses to emit open-map index signatures — we strip this before passing to quicktype.

- [ ] In `codegen.ts`, delete the entire `InlineSchemaStore` class (lines 32–36):
  ```typescript
  // No-op schema store — all schemas are self-contained (no $ref across files)
  class InlineSchemaStore extends JSONSchemaStore {
    async fetch(_address: string) {
      return undefined
    }
  }
  ```
- [ ] In its place, add `FlatSchemaStore`:
  ```typescript
  /**
   * Schema store backed by the full registry. Resolves $ref addresses by name
   * so that any future schema using $defs or z.lazy() resolves correctly.
   */
  class FlatSchemaStore extends JSONSchemaStore {
    private readonly schemaMap: Map<string, object>

    constructor(schemas: Array<{ name: string; schema: string }>) {
      super()
      this.schemaMap = new Map(schemas.map(({ name, schema }) => [name, JSON.parse(schema)]))
    }

    async fetch(address: string): Promise<object | undefined> {
      return this.schemaMap.get(address)
    }
  }
  ```
- [ ] Update the store construction inside `generateForLanguage()` — the function signature stays the same. Only replace the first line of the function body:
  - Replace: `const store = new InlineSchemaStore()`
  - With: `const store = new FlatSchemaStore(schemas)`
  - No other changes needed to the function signature or body.
- [ ] Add `stripAdditionalProperties` helper function above `generateForLanguage`:
  ```typescript
  /**
   * Recursively remove "additionalProperties" from a JSON Schema object.
   * z.looseObject() emits additionalProperties: {} which causes quicktype to add
   * open-map index signatures to generated types. Strip it before passing to quicktype.
   */
  function stripAdditionalProperties(schema: object): object {
    const s = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>
    delete s['additionalProperties']
    if (s['properties'] && typeof s['properties'] === 'object') {
      for (const key of Object.keys(s['properties'] as object)) {
        const prop = (s['properties'] as Record<string, object>)[key]
        if (prop && typeof prop === 'object') {
          (s['properties'] as Record<string, object>)[key] = stripAdditionalProperties(prop) as object
        }
      }
    }
    if (Array.isArray(s['items'])) {
      s['items'] = (s['items'] as object[]).map(stripAdditionalProperties)
    } else if (s['items'] && typeof s['items'] === 'object') {
      s['items'] = stripAdditionalProperties(s['items'] as object)
    }
    return s
  }
  ```
- [ ] In `main()`, apply `stripAdditionalProperties` when building `allSchemas`. Replace:
  ```typescript
  const allSchemas = registry.map(({ name, jsonSchema }) => ({
    name,
    schema: JSON.stringify(jsonSchema),
  }))
  ```
  With:
  ```typescript
  const allSchemas = registry.map(({ name, jsonSchema }) => ({
    name,
    schema: JSON.stringify(stripAdditionalProperties(jsonSchema)),
  }))
  ```
- [ ] Run `bun run codegen` — confirm it exits 0.
- [ ] Run `grep -c "PurpleOption\|FluffyOption\|TentacledOption" packages/protocol/generated/kotlin/Types.kt` — count should be same or lower than baseline (no regression).
- [ ] Commit: `git commit -m "refactor(codegen): replace InlineSchemaStore with FlatSchemaStore, strip additionalProperties"`

---

### Task 2 (Phase B): Remove TypeScript from codegen output

**Files:**
- Modify: `packages/protocol/tools/codegen.ts`
- Modify: `.gitignore`
- Delete: `packages/protocol/generated/typescript/` (directory)

**Context:** `packages/protocol/generated/typescript/types.ts` (4240 lines) is never imported anywhere — confirmed by `grep -r "@protocol/generated" src/ apps/worker/ packages/shared/` returning nothing. The TypeScript crypto-labels file (`generated/typescript/crypto-labels.ts`) is also never imported; all TypeScript consumers use `@shared/crypto-labels` which imports directly from `packages/shared/crypto-labels.ts` (a hand-maintained source file that already has all labels). Removing TypeScript output eliminates 4000+ lines of confusion-inducing dead weight.

**Important verification first:**
- [ ] Run `grep -r "generated/typescript" packages/ src/ apps/worker/ apps/desktop/` — must return nothing (confirms no imports of generated TS output). If any are found, fix those imports to use `@protocol/schemas` patterns before proceeding.
- [ ] Run `grep -r "@protocol/generated" packages/ src/ apps/` — must also return nothing.

**Edits to `codegen.ts`:**
- [ ] Delete the `generateTSCryptoLabels` function (lines 106–117).
- [ ] In `main()`, remove TypeScript from the `Promise.all` call. Change:
  ```typescript
  const [tsLines, swiftLines, kotlinLines] = await Promise.all([
    generateForLanguage('typescript', allSchemas, {
      'just-types': 'true',
    }),
    generateForLanguage('swift', allSchemas, { ... }),
    generateForLanguage('kotlin', allSchemas, { ... }),
  ])
  ```
  To:
  ```typescript
  const [swiftLines, kotlinLines] = await Promise.all([
    generateForLanguage('swift', allSchemas, { ... }),
    generateForLanguage('kotlin', allSchemas, { ... }),
  ])
  ```
- [ ] Delete the line: `const tsContent = header + tsLines.join('\n') + '\n'`
- [ ] Delete the line: `const tsCryptoContent = generateTSCryptoLabels(cryptoLabels)`
- [ ] In the directory creation loop, remove `'typescript'` from `['typescript', 'swift', 'kotlin']` → `['swift', 'kotlin']`.
- [ ] Delete the two `writeFileSync` calls for TypeScript:
  ```typescript
  writeFileSync(join(GENERATED_DIR, 'typescript', 'types.ts'), tsContent)
  writeFileSync(join(GENERATED_DIR, 'typescript', 'crypto-labels.ts'), tsCryptoContent)
  ```
- [ ] Update the final `console.log` lines to remove the TypeScript line:
  ```typescript
  console.log('Generated:')
  console.log('  swift/Types.swift + CryptoLabels.swift')
  console.log('  kotlin/Types.kt + CryptoLabels.kt')
  ```
- [ ] Update the codegen tool's top-of-file JSDoc comment to reflect Swift + Kotlin only (remove TypeScript mention).

**Filesystem cleanup:**
- [ ] Delete the generated TypeScript directory: `rm -rf packages/protocol/generated/typescript/`
- [ ] In `.gitignore` (line 19: `packages/protocol/generated/`), the whole generated dir is already gitignored — no change needed for typescript subdir specifically. Verify this is the case and the `typescript/` subdir was only produced by codegen (no committed files).

**Verification:**
- [ ] Run `bun run codegen` — confirm it exits 0 and only mentions Swift + Kotlin in output.
- [ ] Run `grep "typescript" packages/protocol/tools/codegen.ts` — should return nothing (or only the JSDoc if not fully cleaned up — remove those too).
- [ ] Run `ls packages/protocol/generated/` — should show only `kotlin/` and `swift/`.
- [ ] Run `bun run typecheck` — confirm no TS errors.
- [ ] Commit: `git commit -m "feat(codegen): remove TypeScript output — consumers use z.infer<> directly"`

---

### Task 3 (Phase C): Automate schema registry via namespace import

**Files:**
- Modify: `packages/protocol/tools/schema-registry.ts`

**Context:** The current registry has 135 explicit `[varName, schema]` entries plus a 130-line import block that must be kept in sync manually. Switching to `import * as allSchemas from '../schemas'` and filtering by `schema instanceof ZodType && exportName.endsWith('Schema')` makes the registry self-maintaining. The only ongoing maintenance is the small `EXCLUDED_SCHEMAS` set.

**Before making changes, capture current schema count:**
- [ ] Run `bun run codegen` and note `"Found N schemas"` — this is the before count.
- [ ] Save a copy of the current Swift output for diffing: `cp packages/protocol/generated/swift/Types.swift /tmp/Types.swift.before`

**Rewrite `schema-registry.ts`:**
- [ ] Delete the entire explicit import block (lines 10–323, all named imports from `'../schemas'`).
- [ ] Delete the `RegistryEntry` interface (lines 330–333) — it is replaced inline below.
- [ ] Delete the `schemaEntries` array (lines 350–662) — the entire explicit list.
- [ ] Keep the `toPascalCase` helper function unchanged.
- [ ] Keep the `SchemaRegistryEntry` export interface unchanged.
- [ ] Replace the import section at the top with:
  ```typescript
  import { toJSONSchema, ZodType } from 'zod'
  import * as schemaExports from '../schemas'
  ```
- [ ] Add the exclusion set immediately after imports:
  ```typescript
  /**
   * Schemas excluded from codegen:
   * - Query schemas (URL parameter validation, not wire types)
   * - Overly generic schemas with no useful mobile representation
   */
  const EXCLUDED_SCHEMAS = new Set([
    'listRecordsQuerySchema',
    'okResponseSchema',
  ])
  ```
- [ ] Rewrite `getSchemaRegistry()` to use auto-discovery:
  ```typescript
  export function getSchemaRegistry(): SchemaRegistryEntry[] {
    const entries: SchemaRegistryEntry[] = []

    for (const [exportName, schema] of Object.entries(schemaExports)) {
      // Only process ZodType instances whose export name ends in Schema
      if (!(schema instanceof ZodType)) continue
      if (!exportName.endsWith('Schema')) continue
      if (EXCLUDED_SCHEMAS.has(exportName)) continue

      const name = toPascalCase(exportName)
      try {
        const jsonSchema = toJSONSchema(schema, { unrepresentable: 'any' })
        entries.push({ name, jsonSchema })
      } catch (err) {
        console.warn(`Warning: Could not convert ${exportName} to JSON Schema, skipping: ${err}`)
      }
    }

    return entries
  }
  ```
- [ ] Note: `stripAdditionalProperties` is applied in `codegen.ts` (in `main()`) after calling `getSchemaRegistry()`, so it is NOT needed here.
- [ ] Run `bun run codegen` — confirm it exits 0.
- [ ] Compare schema count: `"Found M schemas"`. If M < N (before count), investigate which schemas are no longer found. This would mean they don't end in `Schema` — rename them or add them to an explicit inclusion set.
- [ ] If M > N, investigate newly discovered schemas (previously missing from the manual registry). Check Swift/Kotlin output for unexpected new types and verify they are correct.
- [ ] Diff the Swift output: `diff /tmp/Types.swift.before packages/protocol/generated/swift/Types.swift` — review all changes. New types are likely additions; removals are regressions.
- [ ] Run `bun run typecheck` — confirm no TS errors.
- [ ] Commit: `git commit -m "refactor(codegen): auto-discover schemas from index.ts, replace manual registry"`

---

### Task 4 (Phase D): Fix `z.unknown()` and `z.any()` schemas to eliminate `JSONAny`

**Files:**
- Modify: `packages/protocol/schemas/audit.ts`
- Modify: `packages/protocol/schemas/calls.ts`
- Modify: `packages/protocol/schemas/contacts.ts`
- Modify: `packages/protocol/schemas/conversations.ts`
- Modify: `packages/protocol/schemas/entity-schema.ts`
- Modify: `packages/protocol/schemas/reports.ts`
- Modify: `packages/protocol/schemas/settings.ts`
- Modify: `packages/protocol/schemas/webauthn.ts`

**Context:** `z.unknown()` as a bare field type (and `z.array(z.unknown())`) serializes to `{}` in JSON Schema, which quicktype converts to `JSONAny` — a 200-line `class JSONAny: Codable` runtime reflection blob. `z.record(z.string(), z.unknown())` is acceptable (maps to `[String: JSONAny]?` in Swift — a dictionary type, not the full JSONAny class definition trigger). Fix the bare `z.unknown()` and `z.array(z.unknown())` usages.

**Verification baseline:**
- [ ] Run `grep -c "JSONAny" packages/protocol/generated/swift/Types.swift` and note the count.

**Fix `audit.ts`:**
- [ ] `auditEntryResponseSchema.details`: Change `z.record(z.string(), z.unknown()).optional()` → `z.record(z.string(), z.string()).optional()`. Audit details are always string key/value pairs.

**Fix `calls.ts`:**
- [ ] `callerIdentifyResponseSchema.contact`: Change `z.unknown().nullable()` → add a `contactSummarySchema` inline or referenced type. Define it above the response schema:
  ```typescript
  export const contactSummarySchema = z.object({
    id: z.string(),
    name: z.string().optional(),
    caseCount: z.number().int().optional(),
    entityType: z.string().optional(),
  }).nullable()
  ```
  Then use: `contact: contactSummarySchema`

**Fix `contacts.ts`:**
- [ ] `contactTimelineListResponseSchema.notes` and `.conversations`: These are `z.array(z.record(z.string(), z.unknown()))`. The items are genuinely free-form timeline entries. Change to `z.array(z.record(z.string(), z.string()))` if they're string-valued, or keep as `z.array(z.record(z.string(), z.unknown()))` — this is the dictionary form which is acceptable (produces `[[String: JSONAny]]` not the full class definition trigger). Leave as-is unless it triggers JSONAny class generation.

**Fix `conversations.ts`:**
- [ ] `updateConversationBodySchema.metadata` and `createConversationBodySchema.metadata`: These are already `z.record(z.string(), z.unknown()).optional()` — the dictionary form. Leave as-is.

**Fix `entity-schema.ts`:**
- [ ] `templateListResponseSchema.templates`: Change `z.array(z.unknown())` → define `templateSummarySchema`:
  ```typescript
  export const templateSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
    entityTypes: z.array(z.string()).optional().default([]),
    roles: z.array(z.string()).optional().default([]),
  })
  ```
  Then: `templates: z.array(templateSummarySchema)`
- [ ] `templateListResponseSchema.updates`: Change `z.array(z.unknown())` → `z.array(templateSummarySchema)`
- [ ] `templateListResponseSchema.suggestedRoles`: Change `z.array(z.unknown()).optional()` → `z.array(z.string()).optional()` (role names are strings)

**Fix `reports.ts`:**
- [ ] `reportResponseSchema.conversations`: Change `z.array(z.unknown())` → `z.array(z.object({ id: z.string(), createdAt: z.string() }))` or the simplest type that matches the actual API shape. Check what `conversations` in a report response contains. If it is genuinely opaque, use `z.array(z.record(z.string(), z.string()))`.

**Fix `settings.ts`:**
- [ ] `migrationStatusResponseSchema.namespaces`: Change `z.array(z.unknown())` → define `migrationNamespaceSchema`:
  ```typescript
  export const migrationNamespaceSchema = z.object({
    name: z.string(),
    status: z.string(),
    recordCount: z.number().int().optional(),
  })
  ```
  Then: `namespaces: z.array(migrationNamespaceSchema)`
- [ ] `cleanupMetricsResponseSchema.settings`, `.identity`, `.conversation`: These are `z.record(z.string(), z.unknown())` — the dictionary form. Change to `z.record(z.string(), z.number())` if the values are metric counts (numbers), or define:
  ```typescript
  const metricsCountsSchema = z.record(z.string(), z.number())
  ```
  And use it for all three fields.

**Fix `webauthn.ts`:**
- [ ] `authenticateBodySchema.assertion` and `registerCredentialBodySchema.attestation`: These are WebAuthn standard opaque objects. The `z.record(z.string(), z.unknown())` form is acceptable — leave as-is (they already use the dictionary form, not bare `z.unknown()`).

**Verification:**
- [ ] Run `bun run codegen`.
- [ ] Run `grep -c "JSONAny" packages/protocol/generated/swift/Types.swift` — count should be lower than baseline or zero.
- [ ] Run `bun run typecheck` — no TS errors.
- [ ] Commit: `git commit -m "fix(schemas): replace z.unknown() bare fields with typed schemas to eliminate JSONAny"`

---

### Task 5 (Phase F): Add `--check` flag for CI drift detection

**Files:**
- Modify: `packages/protocol/tools/codegen.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Context:** Generated Swift and Kotlin files are gitignored and regenerated in CI. Currently there is no gate to catch a developer who changes a Zod schema without running `bun run codegen`. This task adds a `--check` mode that compares the output it would write against the files already on disk, exits 1 with a clear error message if they differ.

**Edits to `codegen.ts`:**
- [ ] Add `existsSync`, `readFileSync` to the `fs` imports at the top (they are already imported — verify `existsSync` is in the import list; if not, add it):
  ```typescript
  import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
  ```
- [ ] Add check-mode flag detection near the top of the file, after imports:
  ```typescript
  const CHECK_MODE = process.argv.includes('--check')
  ```
- [ ] Add a `writeOrCheck` helper function:
  ```typescript
  /**
   * In normal mode: write content to outputPath.
   * In --check mode: compare content to existing file; exit 1 if different.
   */
  function writeOrCheck(outputPath: string, content: string): void {
    if (CHECK_MODE) {
      const existing = existsSync(outputPath) ? readFileSync(outputPath, 'utf-8') : ''
      if (existing !== content) {
        console.error(`DRIFT DETECTED: ${outputPath} is out of sync with schemas.`)
        console.error('Run: bun run codegen')
        process.exit(1)
      }
    } else {
      writeFileSync(outputPath, content)
    }
  }
  ```
- [ ] Replace the two `writeFileSync` calls in `main()` with `writeOrCheck`:
  ```typescript
  // Replace:
  writeFileSync(join(GENERATED_DIR, 'swift', 'Types.swift'), swiftContent)
  writeFileSync(join(GENERATED_DIR, 'swift', 'CryptoLabels.swift'), swiftCryptoContent)
  writeFileSync(join(GENERATED_DIR, 'kotlin', 'Types.kt'), kotlinContent)
  writeFileSync(join(GENERATED_DIR, 'kotlin', 'CryptoLabels.kt'), kotlinCryptoContent)
  // With:
  writeOrCheck(join(GENERATED_DIR, 'swift', 'Types.swift'), swiftContent)
  writeOrCheck(join(GENERATED_DIR, 'swift', 'CryptoLabels.swift'), swiftCryptoContent)
  writeOrCheck(join(GENERATED_DIR, 'kotlin', 'Types.kt'), kotlinContent)
  writeOrCheck(join(GENERATED_DIR, 'kotlin', 'CryptoLabels.kt'), kotlinCryptoContent)
  ```
- [ ] In `--check` mode, skip directory creation (the dirs must already exist from a prior codegen run). Wrap the `mkdirSync` loop:
  ```typescript
  if (!CHECK_MODE) {
    for (const dir of ['swift', 'kotlin']) {
      mkdirSync(join(GENERATED_DIR, dir), { recursive: true })
    }
  }
  ```
- [ ] Update the final log lines to indicate check mode vs. generate mode:
  ```typescript
  if (CHECK_MODE) {
    console.log('Check passed: generated files are up-to-date.')
  } else {
    console.log('Generated:')
    console.log('  swift/Types.swift + CryptoLabels.swift')
    console.log('  kotlin/Types.kt + CryptoLabels.kt')
  }
  ```

**Edit `package.json`:**
- [ ] Add `"codegen:check"` script after `"codegen"` (line 59):
  ```json
  "codegen": "bun run packages/protocol/tools/codegen.ts",
  "codegen:check": "bun run packages/protocol/tools/codegen.ts --check",
  ```

**Edit `.github/workflows/ci.yml`:**
- [ ] In the `build-validate` job, after the existing `"Run codegen"` step, add a new step:
  ```yaml
  - name: Check codegen is up-to-date
    run: bun run codegen:check
  ```
  Place this immediately after the `bun run codegen` step and before the `Validate i18n strings` step.
- [ ] In the Android job (which has `"Install dependencies and run codegen"` as a combined step), add a separate step after it:
  ```yaml
  - name: Check codegen is up-to-date
    run: bun run codegen:check
  ```

**Verification:**
- [ ] Run `bun run codegen` then `bun run codegen:check` — the check should pass (exit 0).
- [ ] Manually corrupt a generated file (`echo "// corrupted" >> packages/protocol/generated/swift/Types.swift`) then run `bun run codegen:check` — it should exit 1 with a clear error message. Restore: `bun run codegen`.
- [ ] Run `bun run typecheck` — no TS errors.
- [ ] Commit: `git commit -m "feat(codegen): add --check mode and codegen:check CI gate for drift detection"`

---

## Final verification

- [ ] Run `bun run codegen` — exits 0, mentions Swift + Kotlin only.
- [ ] Run `bun run codegen:check` — exits 0.
- [ ] Run `bun run typecheck` — exits 0.
- [ ] Run `grep "typescript" packages/protocol/tools/codegen.ts` — returns nothing (or only unrelated occurrences in comments).
- [ ] Run `grep -r "@protocol/generated" src/ apps/worker/ packages/shared/ apps/desktop/` — returns nothing.
- [ ] Run `ls packages/protocol/generated/` — shows only `kotlin/` and `swift/`.
- [ ] Run `grep -c "PurpleOption\|FluffyOption\|TentacledOption" packages/protocol/generated/kotlin/Types.kt` — count same or lower than original baseline.
- [ ] Run `grep -c "JSONAny" packages/protocol/generated/swift/Types.swift` — count lower than original baseline.
