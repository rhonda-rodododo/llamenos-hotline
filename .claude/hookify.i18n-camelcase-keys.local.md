---
name: enforce-i18n-camelcase-keys
enabled: true
event: file
action: block
conditions:
  - field: file_path
    operator: regex_match
    pattern: packages/i18n/locales/en\.json$
  - field: new_text
    operator: regex_match
    pattern: "_[a-z0-9]"\s*:
---

**en.json keys must be camelCase, never snake_case.**

The i18n codegen pipeline (`bun run i18n:codegen`) automatically converts camelCase → snake_case when generating iOS `.strings` and Android `strings.xml`. Adding snake_case keys to en.json produces double-underscored keys on mobile (e.g., `some__key`).

**Convention:**
- en.json: `"activeCalls"` (camelCase)
- iOS output: `"active_calls"` (auto-converted)
- Android output: `"active_calls"` (auto-converted)

**Fix:** Rename the key to camelCase. For example:
- `snake_case` → `snakeCase`
- `my_feature_label` → `myFeatureLabel`

See the i18n-string-workflow skill for full conventions.
