# Epic 338: Template Translations & Locale Completeness

**Status**: PENDING
**Priority**: Medium
**Depends on**: Epic 317 (Template System), Epic 205 (i18n Extraction)
**Blocks**: None
**Branch**: `desktop`

## Summary

Complete i18n coverage for CMS by: (1) adding professional-quality translations for all 13 templates across all 13 locales beyond EN/ES, (2) filling all CMS-related i18n gaps in the 11 non-EN/ES locale files, and (3) validating with `bun run i18n:validate:all` and running codegen for iOS `.strings` and Android `strings.xml`.

## Problem Statement

The CMS added ~260 new i18n keys to `en.json` (under `caseManagement.*`, `cases.*`, `contacts.*`, `templates.*`). Spanish (`es.json`) was translated during CMS implementation. The other 11 locales (AR, DE, FR, HT, HI, KO, PT, RU, TL, VI, ZH) have no CMS translations.

Additionally, the 13 templates in `packages/protocol/templates/` have human-readable labels and descriptions (`entityTypes[].label`, `entityTypes[].labelPlural`, `fields[].label`, `statuses[].label`, `severities[].label`, `contactRoles[].label`) that are only in English. These labels appear in the admin template browser and schema editor -- they need translation for non-English deployments.

### Current State

Locale files: `packages/i18n/locales/{en,es,ar,de,fr,ht,hi,ko,pt,ru,tl,vi,zh}.json`

Templates: `packages/protocol/templates/{jail-support,street-medic,general-hotline,ice-rapid-response,bail-fund,dv-crisis,anti-trafficking,hate-crime-reporting,copwatch,tenant-organizing,mutual-aid,missing-persons,kyr-training}.json`

### Scale of Work

- ~260 CMS keys x 11 locales = ~2,860 string translations
- 13 templates with ~20-40 labels each = ~260-520 template labels x 12 non-EN locales = ~3,120-6,240 template translations
- Total: ~6,000-9,000 individual translations

## Implementation

### Phase 1: Audit Missing Keys

Run `bun run i18n:validate:all` to get a definitive list of missing keys per locale.

Also audit templates:
```bash
# Count translatable labels in templates
for f in packages/protocol/templates/*.json; do
  echo "$(basename $f): $(jq '[.. | .label?, .labelPlural? | select(. != null)] | length' $f)"
done
```

### Phase 2: Template i18n Architecture

Templates currently embed English labels directly in JSON. Two approaches:

**Option A: i18n keys in templates** (chosen)
Add an `i18n` object to each template that maps field/status/role labels to i18n keys:

```json
{
  "id": "jail-support",
  "name": "Jail Support",
  "i18n": {
    "name": "templates.jailSupport.name",
    "description": "templates.jailSupport.description",
    "entityTypes": {
      "arrest_case": {
        "label": "templates.jailSupport.arrestCase.label",
        "labelPlural": "templates.jailSupport.arrestCase.labelPlural"
      }
    }
  }
}
```

Then add the full tree under `templates.*` in each locale file.

**Option B: Separate translation files per template** -- rejected, too fragmented.

### Phase 3: Locale Translations

For each of the 11 non-EN/ES locales, add the complete `caseManagement`, `cases`, `contacts`, and `templates` sections.

Organize by priority:
1. **Tier 1** (highest deployment demand): ZH (Chinese), AR (Arabic), FR (French), PT (Portuguese)
2. **Tier 2**: DE (German), RU (Russian), KO (Korean), HI (Hindi)
3. **Tier 3**: TL (Tagalog), VI (Vietnamese), HT (Haitian Creole)

Key sections to translate in each locale:

```json
{
  "caseManagement": { /* ~80 keys: settings, toggle, entity types, fields, schema editor */ },
  "cases": { /* ~60 keys: list, detail, create, status, assignment, bulk, pagination */ },
  "contacts": { /* ~40 keys: directory, search, create, profile tabs, identifiers */ },
  "templates": {
    "jailSupport": { /* ~45 keys: name, description, entity type labels, field labels, status labels */ },
    "streetMedic": { /* ~25 keys */ },
    "generalHotline": { /* ~15 keys */ },
    "iceRapidResponse": { /* ~35 keys */ },
    "bailFund": { /* ~20 keys */ },
    "dvCrisis": { /* ~30 keys */ },
    "antiTrafficking": { /* ~25 keys */ },
    "hateCrimeReporting": { /* ~20 keys */ },
    "copwatch": { /* ~20 keys */ },
    "tenantOrganizing": { /* ~20 keys */ },
    "mutualAid": { /* ~15 keys */ },
    "missingPersons": { /* ~25 keys */ },
    "kyrTraining": { /* ~15 keys */ }
  }
}
```

### Phase 4: Template JSON Updates

Update each template in `packages/protocol/templates/` to include i18n key references. The template browser component (`src/client/components/admin/template-browser.tsx`) must use `t()` lookups for template labels instead of raw strings.

### Phase 5: Validation & Codegen

```bash
# Validate all locales are complete
bun run i18n:validate:all

# Validate desktop t() calls match en.json
bun run i18n:validate:desktop

# Generate iOS .strings files
bun run i18n:codegen

# Validate iOS string refs
bun run i18n:validate:ios

# Validate Android string refs
bun run i18n:validate:android
```

Fix any validation errors.

### Phase 6: RTL Testing for Arabic

Arabic is RTL. Verify that CMS components render correctly:
- Case list table/cards
- Status pills (text direction)
- Schema form labels and inputs
- Contact directory search input
- Template browser cards

Use `bun run tauri:dev` with Arabic locale selected in settings.

## Files to Modify

| File | Change |
|------|--------|
| `packages/i18n/locales/ar.json` | Add CMS + template translations (Arabic) |
| `packages/i18n/locales/de.json` | Add CMS + template translations (German) |
| `packages/i18n/locales/fr.json` | Add CMS + template translations (French) |
| `packages/i18n/locales/ht.json` | Add CMS + template translations (Haitian Creole) |
| `packages/i18n/locales/hi.json` | Add CMS + template translations (Hindi) |
| `packages/i18n/locales/ko.json` | Add CMS + template translations (Korean) |
| `packages/i18n/locales/pt.json` | Add CMS + template translations (Portuguese) |
| `packages/i18n/locales/ru.json` | Add CMS + template translations (Russian) |
| `packages/i18n/locales/tl.json` | Add CMS + template translations (Tagalog) |
| `packages/i18n/locales/vi.json` | Add CMS + template translations (Vietnamese) |
| `packages/i18n/locales/zh.json` | Add CMS + template translations (Chinese) |
| `packages/i18n/locales/en.json` | Add `templates.*` section for template labels |
| `packages/i18n/locales/es.json` | Add `templates.*` section for template labels |
| `packages/protocol/templates/*.json` | Add `i18n` key mappings (all 13 templates) |
| `src/client/components/admin/template-browser.tsx` | Use `t()` for template labels |
| `src/client/components/cases/SchemaForm.tsx` | Use `t()` for field labels from templates |

## Testing

```bash
bun run i18n:validate:all        # All locale files complete
bun run i18n:validate:desktop    # Desktop t() calls match en.json
bun run i18n:codegen             # Generate platform strings
bun run i18n:validate:ios        # iOS .strings refs valid
bun run i18n:validate:android    # Android strings.xml refs valid
bun run typecheck                # No TS errors from i18n changes
```

## Acceptance Criteria

- [ ] All 13 locale files have complete CMS translations (0 missing keys from `bun run i18n:validate:all`)
- [ ] All 13 templates have i18n key mappings
- [ ] Template browser displays localized labels when non-EN locale is selected
- [ ] Schema form renders localized field labels from templates
- [ ] `bun run i18n:codegen` produces updated iOS `.strings` and Android `strings.xml`
- [ ] `bun run i18n:validate:desktop` passes
- [ ] `bun run i18n:validate:ios` passes
- [ ] `bun run i18n:validate:android` passes
- [ ] Arabic RTL rendering is correct for CMS pages

## Risk Assessment

- **High**: Translation quality -- machine translations may have legal/medical terminology errors. Mitigated by using context-aware translation and flagging legal terms for review.
- **Medium**: Template i18n architecture adds complexity to template loading. Mitigated by keeping it as a simple key mapping, not runtime interpolation.
- **Low**: Codegen is well-tested from Epic 205 and runs reliably.
