# Epic 316: Blind Index Infrastructure

**Status**: PENDING
**Priority**: High
**Depends on**: Epic 315 (Entity Schema Engine)
**Blocks**: Epic 318, 319, 320, 325
**Branch**: `desktop`

## Summary

Build the hub-key-derived HMAC blind index system that enables server-side filtering of encrypted enum values, date ranges, and partial text matching without the server knowing what the values mean. This is the bridge between E2EE (server can't read content) and usability (server can filter records). Implements three query types: exact match (enum/status/type), epoch bucketing (date ranges), and trigram tokenization (name search). The blind index key is derived from the hub key via HKDF with a new domain separation label. ~8 files modified/created.

## Problem Statement

In an E2EE system, the server cannot read any field values — all content is encrypted. But users need to filter records by status, severity, date range, and search contacts by name. Without blind indexes, the only option is to fetch ALL records and filter client-side, which is unacceptable at scale (1000+ cases during mass arrests).

The blind index pattern solves this: the client computes a deterministic hash (HMAC) of each filterable value using a hub-specific key and sends the hash alongside the encrypted content. The server can match hashes for exact equality without knowing the plaintext. For date ranges, epoch bucketing creates hashes at multiple granularities (day/week/month). For name search, trigram tokenization creates partial-match indexes.

This pattern is proven by CipherSweet (Paragonie), CipherStash, and IronCore Labs' encrypted search products.

## Implementation

### Phase 1: API + Shared Specs

#### Task 1: Blind Index Utility (Rust — packages/crypto)

**File**: `packages/crypto/src/blind_index.rs` (new)

Implement blind index generation in Rust (compiled to native + WASM + UniFFI):

```rust
use hmac::{Hmac, Mac};
use sha2::Sha256;
use hkdf::Hkdf;

type HmacSha256 = Hmac<Sha256>;

/// Derive a field-specific blind index key from the hub key.
/// Each field gets its own key to prevent cross-field correlation.
pub fn derive_blind_index_key(hub_key: &[u8; 32], field_name: &str) -> [u8; 32] {
    let hkdf = Hkdf::<Sha256>::new(
        Some(b"llamenos:blind-index-key"),
        hub_key,
    );
    let mut okm = [0u8; 32];
    let info = format!("llamenos:blind-idx:{}", field_name);
    hkdf.expand(info.as_bytes(), &mut okm)
        .expect("HKDF expand failed");
    okm
}

/// Compute a blind index token for exact-match queries.
/// Returns hex-encoded HMAC-SHA256 of the canonicalized value.
pub fn blind_index(hub_key: &[u8; 32], field_name: &str, value: &str) -> String {
    let key = derive_blind_index_key(hub_key, field_name);
    let canonical = canonicalize(value);
    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC key error");
    mac.update(canonical.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Compute date-bucketed blind indexes at day/week/month granularity.
/// Returns a map of { "{field}_day": hash, "{field}_week": hash, "{field}_month": hash }.
pub fn date_blind_indexes(
    hub_key: &[u8; 32],
    field_name: &str,
    iso_date: &str, // "2026-03-14"
) -> Vec<(String, String)> {
    let day = &iso_date[..10]; // "2026-03-14"
    let month = &iso_date[..7]; // "2026-03"
    let week = iso_week_string(iso_date); // "2026-W11"

    vec![
        (format!("{}_day", field_name), blind_index(hub_key, &format!("{}:day", field_name), day)),
        (format!("{}_week", field_name), blind_index(hub_key, &format!("{}:week", field_name), &week)),
        (format!("{}_month", field_name), blind_index(hub_key, &format!("{}:month", field_name), month)),
    ]
}

/// Generate trigram tokens for partial text matching.
/// Returns blind index tokens for each trigram of the canonicalized input.
pub fn name_trigram_indexes(hub_key: &[u8; 32], field_name: &str, value: &str) -> Vec<String> {
    let canonical = canonicalize(value);
    if canonical.len() < 3 {
        // For very short values, index the whole value
        return vec![blind_index(hub_key, &format!("{}:trigram", field_name), &canonical)];
    }
    let mut tokens = Vec::new();
    let chars: Vec<char> = canonical.chars().collect();
    for i in 0..=(chars.len().saturating_sub(3)) {
        let trigram: String = chars[i..i+3].iter().collect();
        tokens.push(blind_index(hub_key, &format!("{}:trigram", field_name), &trigram));
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

/// Canonicalize a value for consistent blind indexing.
/// Lowercase, strip diacritics, trim whitespace.
fn canonicalize(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        // Simple ASCII normalization — strip combining diacritical marks
        .nfkd()
        .filter(|c| !c.is_mark_nonspacing())
        .collect()
}

fn iso_week_string(iso_date: &str) -> String {
    // Parse ISO date and return "YYYY-Www" format
    // e.g., "2026-03-14" → "2026-W11"
    use chrono::{NaiveDate, Datelike};
    let date = NaiveDate::parse_from_str(&iso_date[..10], "%Y-%m-%d")
        .unwrap_or_else(|_| NaiveDate::from_ymd_opt(2000, 1, 1).unwrap());
    let iso = date.iso_week();
    format!("{}-W{:02}", iso.year(), iso.week())
}
```

#### Task 2: Blind Index TypeScript Client Wrapper

**File**: `src/client/lib/blind-index.ts` (new)

Client-side wrapper that calls through to Rust via `platform.ts` IPC:

```typescript
import { invoke } from '@/lib/platform'

/**
 * Compute a blind index token for exact-match server-side filtering.
 * The server sees only the token (hex hash), never the plaintext value.
 */
export async function blindIndex(fieldName: string, value: string): Promise<string> {
  return invoke<string>('blind_index', { fieldName, value })
}

/**
 * Compute date-bucketed blind indexes at day/week/month granularity.
 * Returns tokens for each granularity level for server-side date range queries.
 */
export async function dateBlindIndexes(
  fieldName: string,
  isoDate: string,
): Promise<Record<string, string>> {
  const pairs = await invoke<[string, string][]>('date_blind_indexes', { fieldName, isoDate })
  return Object.fromEntries(pairs)
}

/**
 * Generate trigram tokens for partial text matching (name search).
 * Returns tokens that can be stored as index entries for substring search.
 */
export async function nameTrigramIndexes(
  fieldName: string,
  value: string,
): Promise<string[]> {
  return invoke<string[]>('name_trigram_indexes', { fieldName, value })
}

/**
 * Compute blind indexes for all indexable fields of a record based on its
 * entity type definition. Called before creating/updating a record.
 */
export async function computeRecordBlindIndexes(
  entityType: import('@shared/types').EntityTypeDefinition,  // Re-exported from packages/shared/types.ts
  fieldValues: Record<string, string | number | boolean>,
  status: string,
  severity?: string,
): Promise<Record<string, string | string[]>> {
  const indexes: Record<string, string | string[]> = {}

  // Always index status and severity
  indexes.statusHash = await blindIndex('status', status)
  if (severity) indexes.severityHash = await blindIndex('severity', severity)

  // Index fields marked as indexable
  for (const field of entityType.fields) {
    if (!field.indexable || field.indexType === 'none') continue
    const value = fieldValues[field.name]
    if (value === undefined || value === null) continue

    if (field.type === 'date') {
      const dateIndexes = await dateBlindIndexes(field.name, String(value))
      Object.assign(indexes, dateIndexes)
    } else {
      indexes[`field_${field.name}`] = await blindIndex(field.name, String(value))
    }
  }

  return indexes
}
```

#### Task 3: Tauri IPC Commands for Blind Index

**File**: `apps/desktop/src/crypto.rs`

Add new IPC commands delegating to `packages/crypto`:

```rust
#[tauri::command]
pub fn blind_index(
    state: tauri::State<CryptoState>,
    field_name: String,
    value: String,
) -> Result<String, String> {
    let hub_key = state.hub_key().ok_or("No hub key available")?;
    Ok(llamenos_crypto::blind_index::blind_index(&hub_key, &field_name, &value))
}

#[tauri::command]
pub fn date_blind_indexes(
    state: tauri::State<CryptoState>,
    field_name: String,
    iso_date: String,
) -> Result<Vec<(String, String)>, String> {
    let hub_key = state.hub_key().ok_or("No hub key available")?;
    Ok(llamenos_crypto::blind_index::date_blind_indexes(&hub_key, &field_name, &iso_date))
}

#[tauri::command]
pub fn name_trigram_indexes(
    state: tauri::State<CryptoState>,
    field_name: String,
    value: String,
) -> Result<Vec<String>, String> {
    let hub_key = state.hub_key().ok_or("No hub key available")?;
    Ok(llamenos_crypto::blind_index::name_trigram_indexes(&hub_key, &field_name, &value))
}
```

Add to `generate_handler![]` in `src/lib.rs`.

#### Task 4: Tauri IPC Mock for Tests

**File**: `tests/mocks/tauri-ipc-handler.ts`

Add mock implementations for Playwright tests:

```typescript
case 'blind_index': {
  // Simple mock: SHA-256 of field_name + value (no hub key in tests)
  const { fieldName, value } = args
  const hash = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${fieldName}:${value.toLowerCase().trim()}`))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

case 'date_blind_indexes': {
  const { fieldName, isoDate } = args
  const day = isoDate.slice(0, 10)
  const month = isoDate.slice(0, 7)
  const week = `${isoDate.slice(0, 4)}-W${Math.ceil(parseInt(isoDate.slice(8, 10)) / 7)}`
  return [
    [`${fieldName}_day`, await mockHash(`${fieldName}:day:${day}`)],
    [`${fieldName}_week`, await mockHash(`${fieldName}:week:${week}`)],
    [`${fieldName}_month`, await mockHash(`${fieldName}:month:${month}`)],
  ]
}

case 'name_trigram_indexes': {
  const { fieldName, value } = args
  const canonical = value.toLowerCase().trim()
  const trigrams = []
  for (let i = 0; i <= canonical.length - 3; i++) {
    trigrams.push(await mockHash(`${fieldName}:trigram:${canonical.slice(i, i + 3)}`))
  }
  return [...new Set(trigrams)]
}
```

#### Task 5: Server-Side Blind Index Query Parsing

**File**: `apps/worker/lib/blind-index-query.ts` (new)

Utility for parsing blind index query parameters and matching against stored indexes:

```typescript
/**
 * Parse blind index filter parameters from URL search params.
 * Convention: parameters ending in "Hash" are blind index filters.
 *
 * Example: ?statusHash=abc123&severityHash=def456&createdMonth=ghi789,jkl012
 */
export function parseBlindIndexFilters(
  searchParams: URLSearchParams,
): Map<string, string[]> {
  const filters = new Map<string, string[]>()

  for (const [key, value] of searchParams) {
    if (key.endsWith('Hash') || key.startsWith('field_') ||
        key.endsWith('_day') || key.endsWith('_week') || key.endsWith('_month') ||
        key === 'nameToken') {
      // Comma-separated values for OR queries (e.g., multiple months)
      filters.set(key, value.split(',').map(v => v.trim()).filter(Boolean))
    }
  }

  return filters
}

/**
 * Check if a record's stored blind indexes match all provided filters.
 * All filters must match (AND). Within a filter, any value can match (OR).
 */
export function matchesBlindIndexFilters(
  recordIndexes: Record<string, string | string[]>,
  filters: Map<string, string[]>,
): boolean {
  for (const [filterKey, filterValues] of filters) {
    const recordValue = recordIndexes[filterKey]
    if (!recordValue) return false

    if (Array.isArray(recordValue)) {
      // Trigram index: any filter value must match any record token
      if (!filterValues.some(fv => recordValue.includes(fv))) return false
    } else {
      // Exact index: any filter value must match
      if (!filterValues.includes(recordValue)) return false
    }
  }

  return true
}
```

#### Task 6: Rust Tests

**File**: `packages/crypto/src/blind_index.rs` (tests module)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blind_index_deterministic() {
        let key = [0u8; 32];
        let a = blind_index(&key, "status", "open");
        let b = blind_index(&key, "status", "open");
        assert_eq!(a, b);
    }

    #[test]
    fn test_blind_index_different_values() {
        let key = [0u8; 32];
        let a = blind_index(&key, "status", "open");
        let b = blind_index(&key, "status", "closed");
        assert_ne!(a, b);
    }

    #[test]
    fn test_blind_index_different_fields() {
        let key = [0u8; 32];
        let a = blind_index(&key, "status", "open");
        let b = blind_index(&key, "severity", "open");
        assert_ne!(a, b); // Same value, different field → different hash
    }

    #[test]
    fn test_blind_index_canonicalization() {
        let key = [0u8; 32];
        let a = blind_index(&key, "name", "Carlos");
        let b = blind_index(&key, "name", "  carlos  ");
        assert_eq!(a, b); // Case and whitespace normalized
    }

    #[test]
    fn test_date_blind_indexes() {
        let key = [0u8; 32];
        let indexes = date_blind_indexes(&key, "created", "2026-03-14");
        assert_eq!(indexes.len(), 3);
        // Day, week, month entries
        assert!(indexes.iter().any(|(k, _)| k == "created_day"));
        assert!(indexes.iter().any(|(k, _)| k == "created_week"));
        assert!(indexes.iter().any(|(k, _)| k == "created_month"));
    }

    #[test]
    fn test_trigram_indexes() {
        let key = [0u8; 32];
        let tokens = name_trigram_indexes(&key, "name", "Carlos");
        // "carlos" → trigrams: "car", "arl", "rlo", "los" = 4 tokens
        assert_eq!(tokens.len(), 4);
    }

    #[test]
    fn test_trigram_short_value() {
        let key = [0u8; 32];
        let tokens = name_trigram_indexes(&key, "name", "ab");
        assert_eq!(tokens.len(), 1); // Too short for trigrams, index whole value
    }

    #[test]
    fn test_different_hub_keys_produce_different_indexes() {
        let key_a = [1u8; 32];
        let key_b = [2u8; 32];
        let a = blind_index(&key_a, "status", "open");
        let b = blind_index(&key_b, "status", "open");
        assert_ne!(a, b); // Different hub keys → different hashes
    }
}
```

#### Task 7: BDD Feature File

**File**: `packages/test-specs/features/core/blind-index.feature`

```gherkin
@backend
Feature: Blind Index Infrastructure
  Server-side filtering of encrypted data using HMAC blind indexes.

  Background:
    Given a registered admin "admin1"
    And case management is enabled
    And an entity type "test_case" with indexable field "priority" of type "select"

  @cases @search
  Scenario: Filter records by status blind index
    Given admin "admin1" creates a record of type "test_case" with status "open"
    And admin "admin1" creates a record of type "test_case" with status "closed"
    When admin "admin1" queries records with statusHash matching "open"
    Then the result should contain 1 record
    And the record should have status "open"

  @cases @search
  Scenario: Filter records by multiple blind indexes (AND)
    Given admin "admin1" creates records:
      | status | priority |
      | open   | high     |
      | open   | low      |
      | closed | high     |
    When admin "admin1" queries with statusHash "open" AND field_priority "high"
    Then the result should contain 1 record

  @cases @search
  Scenario: Date range query via epoch bucketing
    Given admin "admin1" creates records on dates:
      | date       |
      | 2026-03-01 |
      | 2026-03-14 |
      | 2026-02-15 |
    When admin "admin1" queries with createdMonth matching "2026-03"
    Then the result should contain 2 records

  @cases @search
  Scenario: Name search via trigram tokens
    Given a contact "Carlos Martinez" exists
    And a contact "Maria Garcia" exists
    When admin "admin1" searches contacts with nameToken matching "car"
    Then the result should contain "Carlos Martinez"
    And the result should not contain "Maria Garcia"

  @cases @search
  Scenario: Blind indexes are hub-specific
    Given hub "hub_a" has a record with status "open"
    And hub "hub_b" has a record with status "open"
    Then the statusHash for "open" in hub_a should differ from hub_b
```

## Files to Create

| File | Purpose |
|------|---------|
| `packages/crypto/src/blind_index.rs` | Rust blind index implementation (native + WASM + UniFFI) |
| `src/client/lib/blind-index.ts` | TypeScript client wrapper via platform.ts IPC |
| `apps/worker/lib/blind-index-query.ts` | Server-side filter parsing and matching |
| `packages/test-specs/features/core/blind-index.feature` | BDD scenarios |
| `tests/steps/backend/blind-index.steps.ts` | Backend step definitions |

## Files to Modify

| File | Change |
|------|--------|
| `packages/crypto/src/lib.rs` | Add `pub mod blind_index;` |
| `apps/desktop/src/crypto.rs` | Add 3 IPC commands (blind_index, date_blind_indexes, name_trigram_indexes) |
| `apps/desktop/src/lib.rs` | Add commands to `generate_handler![]` |
| `src/client/lib/platform.ts` | Add blind index invoke wrappers |
| `tests/mocks/tauri-ipc-handler.ts` | Add mock implementations |

## Testing

### Rust Unit Tests
- `cargo test --manifest-path packages/crypto/Cargo.toml` — 8 tests in blind_index module

### Backend BDD
- `bun run test:backend:bdd` — 5 scenarios in `blind-index.feature`

## Acceptance Criteria & Test Scenarios

- [ ] Blind index produces deterministic hashes for same input
  -> `packages/crypto: test_blind_index_deterministic`
- [ ] Different values produce different hashes
  -> `packages/crypto: test_blind_index_different_values`
- [ ] Different field names produce different hashes (cross-field isolation)
  -> `packages/crypto: test_blind_index_different_fields`
- [ ] Canonicalization normalizes case and whitespace
  -> `packages/crypto: test_blind_index_canonicalization`
- [ ] Date blind indexes produce day/week/month granularities
  -> `packages/crypto: test_date_blind_indexes`
- [ ] Trigram indexes produce correct number of tokens
  -> `packages/crypto: test_trigram_indexes`
- [ ] Different hub keys produce different indexes
  -> `packages/crypto: test_different_hub_keys_produce_different_indexes`
- [ ] Records can be filtered by status blind index
  -> `packages/test-specs/features/core/blind-index.feature: "Filter records by status blind index"`
- [ ] Multiple blind index filters combine with AND
  -> `packages/test-specs/features/core/blind-index.feature: "Filter records by multiple blind indexes"`
- [ ] Date range queries work via epoch bucketing
  -> `packages/test-specs/features/core/blind-index.feature: "Date range query via epoch bucketing"`
- [ ] Name search works via trigram tokens
  -> `packages/test-specs/features/core/blind-index.feature: "Name search via trigram tokens"`
- [ ] All platform BDD suites pass (`bun run test:all`)
- [ ] Backlog files updated

## Feature Files

| File | Status | Description |
|------|--------|-------------|
| `packages/test-specs/features/core/blind-index.feature` | New | 5 scenarios for blind index queries |
| `tests/steps/backend/blind-index.steps.ts` | New | Backend step definitions |

## Risk Assessment

- **Low risk**: Rust implementation (Task 1) — standard HMAC/HKDF, well-tested primitives from existing dependencies (sha2, hmac, hkdf crates already in packages/crypto/Cargo.toml)
- **Low risk**: TypeScript wrapper (Task 2) — thin IPC layer over Rust
- **Medium risk**: Tauri IPC (Task 3) — requires hub key access from CryptoState. The hub key must be loaded before blind indexes can be computed. Need to handle the "no hub key yet" case gracefully.
- **Low risk**: Server-side query parsing (Task 5) — string matching against stored hashes, no crypto operations on server

## Execution

- Tasks 1-3 are sequential (Rust → IPC → TypeScript)
- Tasks 4-5 are independent of 1-3 (mock + server utils)
- Task 6 (tests) depends on Task 1
- Task 7 (BDD) depends on all
- **Phase 1**: All tasks → `bun run test:backend:bdd`
- **Phase 2**: No desktop UI in this epic (blind indexes are invisible infrastructure)
- **Phase 3**: `bun run test:all`
