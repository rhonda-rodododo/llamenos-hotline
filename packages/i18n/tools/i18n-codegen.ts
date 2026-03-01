#!/usr/bin/env bun
/**
 * i18n codegen tool.
 *
 * Generates iOS .strings and Android strings.xml from the JSON locale files.
 * Also validates translation coverage across all locales.
 *
 * Usage:
 *   bun run i18n:codegen              # Generate iOS + Android strings
 *   bun run i18n:validate             # Check coverage only (no file output)
 *   bun run i18n:validate --verbose   # Show missing keys
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const LOCALES_DIR = resolve(__dirname, '../locales')
const GENERATED_DIR = resolve(__dirname, '../generated')

// Locale code mapping for platform-specific formats
const IOS_LOCALE_MAP: Record<string, string> = {
  zh: 'zh-Hans',
  pt: 'pt-BR',
}

const ANDROID_LOCALE_MAP: Record<string, string> = {
  zh: 'zh-rCN',
  pt: 'pt-rBR',
}

// Flatten nested JSON to underscore-separated keys
function flattenKeys(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value as Record<string, unknown>, fullKey))
    } else if (typeof value === 'string') {
      result[fullKey] = value
    }
  }
  return result
}

// Convert i18next interpolation to iOS format
function toIOSString(value: string): string {
  let index = 0
  return value.replace(/\{\{(\w+)\}\}/g, () => {
    index++
    return index === 1 ? '%@' : `%${index}$@`
  })
}

// Convert i18next interpolation to Android format
function toAndroidString(value: string): string {
  let index = 0
  return value
    .replace(/\{\{(\w+)\}\}/g, () => {
      index++
      return index === 1 ? '%s' : `%${index}$s`
    })
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
}

// Generate iOS Localizable.strings
function generateIOS(keys: Record<string, string>): string {
  const lines = Object.entries(keys)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `"${key}" = "${toIOSString(value)}";`)
  return lines.join('\n') + '\n'
}

// Generate Android strings.xml
function generateAndroid(keys: Record<string, string>): string {
  const entries = Object.entries(keys)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `    <string name="${key}">${toAndroidString(value)}</string>`)
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${entries.join('\n')}\n</resources>\n`
}

// Main codegen
function main() {
  const validate = process.argv.includes('--validate')
  const verbose = process.argv.includes('--verbose')

  // Read English as reference
  const enKeys = flattenKeys(JSON.parse(readFileSync(join(LOCALES_DIR, 'en.json'), 'utf-8')))
  const enKeyCount = Object.keys(enKeys).length

  console.log(`Source: ${enKeyCount} keys in English`)

  const localeFiles = readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json'))
  let hasErrors = false

  for (const file of localeFiles) {
    const locale = file.replace('.json', '')
    const data = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8'))
    const keys = flattenKeys(data)

    // Validate coverage
    if (locale !== 'en') {
      const missing = Object.keys(enKeys).filter(k => !(k in keys))
      if (missing.length > 0) {
        console.warn(`  ${locale}: ${missing.length} missing keys`)
        if (verbose) missing.slice(0, 10).forEach(k => console.warn(`    - ${k}`))
        hasErrors = true
      } else {
        console.log(`  ${locale}: ${Object.keys(keys).length} keys (complete)`)
      }
    }

    if (validate) continue

    // Generate iOS
    const iosLocale = IOS_LOCALE_MAP[locale] || locale
    const iosDir = join(GENERATED_DIR, 'ios', `${iosLocale}.lproj`)
    mkdirSync(iosDir, { recursive: true })
    writeFileSync(join(iosDir, 'Localizable.strings'), generateIOS(keys))

    // Generate Android
    const androidLocale = ANDROID_LOCALE_MAP[locale] || locale
    const androidDir = join(GENERATED_DIR, 'android', locale === 'en' ? 'values' : `values-${androidLocale}`)
    mkdirSync(androidDir, { recursive: true })
    writeFileSync(join(androidDir, 'strings.xml'), generateAndroid(keys))
  }

  if (validate && hasErrors) {
    process.exit(1)
  }

  if (!validate) {
    console.log(`Generated strings for ${localeFiles.length} locales (iOS + Android)`)
  }
}

main()
