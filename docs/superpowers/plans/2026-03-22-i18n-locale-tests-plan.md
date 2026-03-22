# i18n Full Locale Coverage Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend locale test coverage from 2 languages (en, es) to all 13 languages. Add RTL (Arabic) layout verification. Confirm locale persistence across reloads.

**Current state:** Tests only verify en ↔ es switching. 11 locales untested. No RTL layout test.

---

## Phase 1: Locale Switching Tests (All 13)

### 1.1 Audit which UI strings to verify per locale
- [ ] Identify 3–5 key strings in each UI area that appear in all 13 locale files:
  - Dashboard: `common.dashboard` or `ui.navigation.dashboard`
  - Notes: `notes.title` or similar
  - Login: `auth.login.title` or similar
  - Admin: `admin.title` or similar
  - Settings: `common.settings`
- [ ] Read `src/client/locales/en.json` to identify exact top-level keys and sample values
- [ ] Instead of hardcoding expected strings, the test should: (1) load the locale JSON file for the current locale, (2) find the key being checked, (3) assert that the rendered page text matches the locale file value. This avoids the maintenance burden of updating hardcoded strings when translations are updated.

### 1.2 Parametric locale test
- [ ] Add to `tests/i18n.spec.ts` (new file):
  ```typescript
  const locales = ['en','es','zh','tl','vi','ar','fr','ht','ko','ru','hi','pt','de']

  for (const locale of locales) {
    test(`locale: ${locale} - dashboard renders in correct language`, async ({ page }) => {
      // ... switch to locale, verify key strings
    })
  }
  ```

### Test 1.3: Each locale renders without missing keys
```
For each locale:
Given: User selects language [locale] from language selector
When: Navigate to dashboard, notes, and settings pages
Then: No untranslated strings visible (no "common.dashboard" raw key visible)
Then: No [locale] placeholder errors
Then: No console errors about missing i18n keys
```
- [ ] Use `page.on('console', msg => { if (msg.text().includes('i18next')) fail(...) })`

### Test 1.4: Locale persists after reload
```
Given: User selects Haitian Creole (ht)
When: Reload page
Then: UI still in Haitian Creole
Then: Language selector shows "Haitian Creole" as selected
```
- [ ] Verify localStorage or server-side language preference is retained

---

## Phase 2: RTL Language Tests (Arabic)

### Test 2.1: Arabic layout uses RTL direction
```
Given: User selects Arabic (ar) language
When: Navigate to dashboard
Then: document.documentElement.dir === 'rtl' OR document.documentElement.lang === 'ar'
Then: Sidebar/navigation is on the RIGHT side (mirrored)
Then: Text is right-aligned
Then: No horizontal overflow (layout doesn't break)
```
- [ ] Use `page.evaluate(() => document.documentElement.dir)` to check
- [ ] Take screenshot for visual comparison

### Test 2.2: Arabic form inputs are RTL
```
Given: Arabic locale active
When: Open note creation form
Then: Text input direction is rtl
Then: Typed Arabic text appears correctly (right-to-left)
```

### Test 2.3: Arabic locale — no layout overflow
```
Given: Arabic locale active
When: Navigate to admin settings page
Then: No horizontal scrollbar (layout fits in viewport)
Then: No text clipping or overflow
```
- [ ] Use `page.evaluate(() => document.body.scrollWidth > document.body.clientWidth)` to detect overflow

---

## Phase 3: Language Selector Tests

### Test 3.1: Language selector shows all 13 languages
```
Given: Login page loaded
When: Click language selector
Then: Dropdown shows all 13 languages in their native names:
  English, Español, 中文, Tagalog, Tiếng Việt, العربية, Français, Kreyòl ayisyen,
  한국어, Русский, हिन्दी, Português, Deutsch
```

### Test 3.2: Language selector available on login page (no auth needed)
```
Given: Not logged in (on /login)
When: Language selector is visible and functional
Then: Switching language translates login page immediately
Then: No authentication required to change language
```

### Test 3.3: Language preference saved to server profile
```
Given: Logged-in volunteer changes language to Korean (ko)
When: Log out and log back in
Then: UI loads in Korean immediately (preference fetched from server)
Then: Language selector shows 한국어 selected
```

---

## Phase 4: Locale File Completeness Verification

- [ ] Add a test utility (not a Playwright test — a standalone script or test setup check):
  - Load all 13 locale JSON files
  - Compare keys in each file to `en.json` (reference)
  - Report any missing keys
  - This should be a `bun run check:locales` script

### Script: `scripts/check-locales.ts`
```typescript
import en from '../src/client/locales/en.json'
const locales = ['es','zh','tl','vi','ar','fr','ht','ko','ru','hi','pt','de']

for (const locale of locales) {
  const translation = await import(`../src/client/locales/${locale}.json`)
  const missing = deepMissingKeys(en, translation)
  if (missing.length) {
    console.error(`${locale}: missing keys:`, missing)
    process.exit(1)
  }
}
```
- [ ] **Important:** The `deepMissingKeys` helper must traverse keys recursively (handling nested objects), not just top-level keys. The initial implementation must include nested key traversal — a flat key check will silently miss missing nested translations.
- [ ] Add `"check:locales": "bun run scripts/check-locales.ts"` to `package.json`
- [ ] Run as part of CI alongside `bun run typecheck`

---

## Completion Checklist

- [ ] Locale tests load values dynamically from locale JSON files (no hardcoded expected strings)
- [ ] Parametric locale test: all 13 languages render without raw keys
- [ ] Arabic RTL: `dir="rtl"` confirmed on `<html>` element
- [ ] Arabic layout: no horizontal overflow
- [ ] Locale persistence: selected language survives page reload
- [ ] Language selector: all 13 languages listed with native names
- [ ] `scripts/check-locales.ts` passes (no missing keys in any locale file)
- [ ] `bunx playwright test tests/i18n.spec.ts` passes
