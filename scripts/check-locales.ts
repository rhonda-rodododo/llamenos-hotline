/**
 * Locale completeness checker.
 * Compares all locale JSON files against the English reference.
 * Exits with code 1 if any locale has missing keys.
 *
 * Usage: bun run check:locales
 */

import en from '../src/client/locales/en.json'

const LOCALES = ['es', 'zh', 'tl', 'vi', 'ar', 'fr', 'ht', 'ko', 'ru', 'hi', 'pt', 'de'] as const
type Locale = (typeof LOCALES)[number]

function deepMissingKeys(reference: Record<string, unknown>, translation: Record<string, unknown>, prefix = ''): string[] {
  const missing: string[] = []
  for (const key of Object.keys(reference)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const refVal = reference[key]
    const transVal = translation[key]

    if (transVal === undefined) {
      missing.push(fullKey)
    } else if (
      typeof refVal === 'object' &&
      refVal !== null &&
      !Array.isArray(refVal) &&
      typeof transVal === 'object' &&
      transVal !== null &&
      !Array.isArray(transVal)
    ) {
      missing.push(
        ...deepMissingKeys(
          refVal as Record<string, unknown>,
          transVal as Record<string, unknown>,
          fullKey
        )
      )
    }
  }
  return missing
}

let hasErrors = false

for (const locale of LOCALES) {
  const translation = (await import(`../src/client/locales/${locale}.json`)) as Record<string, unknown>
  // Dynamic imports include a `default` key
  const translationData = ('default' in translation ? translation.default : translation) as Record<string, unknown>
  const enData = en as unknown as Record<string, unknown>

  const missing = deepMissingKeys(enData, translationData)

  if (missing.length > 0) {
    console.error(`\n❌ ${locale}: ${missing.length} missing key(s):`)
    for (const key of missing) {
      console.error(`   - ${key}`)
    }
    hasErrors = true
  } else {
    console.log(`✅ ${locale}: complete`)
  }
}

if (hasErrors) {
  console.error('\nLocale check failed. Add missing translations above.')
  process.exit(1)
} else {
  console.log('\nAll locales complete.')
}
