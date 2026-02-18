#!/usr/bin/env bun
/**
 * Bump version, tag, and regenerate changelog.
 *
 * Usage:
 *   bun run version:bump <major|minor|patch> [description]
 *
 * Example:
 *   bun run version:bump minor "Epic 55 — Cloudflare Tunnel"
 *
 * This will:
 *   1. Bump the version in package.json
 *   2. Commit the version change
 *   3. Create an annotated git tag
 *   4. Regenerate CHANGELOG.md via git-cliff
 *   5. Commit the updated changelog
 *
 * It does NOT push — run `git push && git push --tags` manually.
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')
const PKG_PATH = resolve(ROOT, 'package.json')

type BumpType = 'major' | 'minor' | 'patch'

function run(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function bumpVersion(current: string, type: BumpType): string {
  const parts = current.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version: ${current}`)
  }
  const [major, minor, patch] = parts
  switch (type) {
    case 'major': return `${major + 1}.0.0`
    case 'minor': return `${major}.${minor + 1}.0`
    case 'patch': return `${major}.${minor}.${patch + 1}`
  }
}

// --- Main ---

const [bumpType, ...descParts] = process.argv.slice(2)
const description = descParts.join(' ')

if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Usage: bun run version:bump <major|minor|patch> [description]')
  process.exit(1)
}

// Check for uncommitted changes
const status = run('git status --porcelain')
if (status) {
  console.error('Error: Working tree has uncommitted changes. Commit or stash first.')
  process.exit(1)
}

// Read and bump version
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'))
const oldVersion = pkg.version
const newVersion = bumpVersion(oldVersion, bumpType as BumpType)

console.log(`Bumping ${oldVersion} → ${newVersion}`)

// Update package.json
pkg.version = newVersion
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')

// Commit version bump
const tagMessage = description || `release v${newVersion}`
run(`git add package.json`)
run(`git commit -m "chore: bump version to ${newVersion}"`)

// Create annotated tag
run(`git tag -a v${newVersion} -m "${tagMessage}"`)
console.log(`Tagged v${newVersion}`)

// Regenerate changelog
run('git-cliff --output CHANGELOG.md')
run('git add CHANGELOG.md')
run(`git commit -m "chore: update changelog for v${newVersion}"`)

console.log(`\nDone! Version ${newVersion} is ready.`)
console.log('Run the following to publish:')
console.log('  git push && git push --tags')
