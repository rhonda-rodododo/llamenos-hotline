/**
 * Locale completeness checker.
 * Compares all locale JSON files against the English reference.
 * Exits with code 1 if any locale has missing keys.
 *
 * Usage: bun run check:locales
 */

import { LANGUAGE_CODES } from '../src/shared/languages'

const NON_EN_CODES = LANGUAGE_CODES.filter((c) => c !== 'en')

function deepMissingKeys(
  reference: Record<string, unknown>,
  translation: Record<string, unknown>,
  prefix = ''
): string[] {
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

const en = (await import('../public/locales/en.json')) as Record<string, unknown>
const enData = ('default' in en ? en.default : en) as Record<string, unknown>

let hasErrors = false

for (const locale of NON_EN_CODES) {
  const translation = (await import(`../public/locales/${locale}.json`)) as Record<string, unknown>
  const translationData = ('default' in translation ? translation.default : translation) as Record<
    string,
    unknown
  >

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
