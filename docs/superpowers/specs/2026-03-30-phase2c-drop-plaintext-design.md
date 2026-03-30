# Field-Level Encryption Phase 2C: Audit & Drop Residual Plaintext — Status

**Date:** 2026-03-30 (revised from 2026-03-28 original)
**Status:** MOSTLY IMPLEMENTED — Minimal remaining work

---

## Summary

Phase 2C originally proposed dropping plaintext columns after Phases 2A and 2B add encrypted companions. The current schema already uses encrypted columns directly — **there are no plaintext companion columns to drop** for most tables.

### Remaining work

1. **Roles: `slug` column** — still exists as plaintext. After Phase 2B upgrades role names to hub-key E2EE, custom slugs like `legal-liaison` reveal org structure. Drop the `slug` column; use role `id` for permission checks (system roles identified by `isDefault` flag).

2. **Verify no plaintext fallback code** — grep for any `serverDecrypt` fallback patterns that read plaintext columns when encrypted columns are empty. Remove these after confirming all writes go to encrypted columns.

3. **NOT NULL constraints** — verify all required encrypted columns have NOT NULL constraints.

### SQL migration

```sql
ALTER TABLE roles DROP COLUMN slug;
```

Update service code that references `role.slug` to use `role.id` instead.

### Verification

- `bun run typecheck` — catches any code referencing dropped columns
- `grep -r "\.slug" src/` — only hits should be URL slugs, not role slugs
- All tests pass
