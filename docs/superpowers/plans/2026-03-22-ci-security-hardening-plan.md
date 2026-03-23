# CI Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete the CI security pipeline: GPG-sign CHECKSUMS.txt (the one piece `verify-build.sh` already expects but CI doesn't produce), add secret scanning, add Dependabot, and publish a security policy.

**Context:** CI is already comprehensive (Biome lint, typecheck, Playwright E2E, SLSA provenance attestation, Trivy scans, CHECKSUMS.txt generation). These are the remaining gaps.

---

## Phase 1: GPG Signing for CHECKSUMS.txt

**Gap:** `scripts/verify-build.sh` checks for `CHECKSUMS.txt.asc` (GPG signature) but the `release` job in `ci.yml` never generates it. The verify script fails silently on signature check.

### 1.1 Add GPG signing to release job in ci.yml
- [x] Read `.github/workflows/ci.yml` — find the `release` job
- [x] Add GPG key setup step before the GitHub Release creation:
  ```yaml
  - name: Import GPG signing key
    run: |
      echo "${{ secrets.RELEASE_GPG_PRIVATE_KEY }}" | gpg --batch --import
      echo "${{ secrets.RELEASE_GPG_KEY_ID }}:6:" | gpg --import-ownertrust

  - name: Sign CHECKSUMS.txt
    run: |
      gpg --batch --armor \
          --local-user "${{ secrets.RELEASE_GPG_KEY_ID }}" \
          --detach-sign CHECKSUMS.txt
      # Produces CHECKSUMS.txt.asc
  ```
- [x] Update the `softprops/action-gh-release` step to also upload `CHECKSUMS.txt.asc`
- [x] Verify `verify-build.sh` correctly imports and verifies with the public key fingerprint

### 1.2 Generate and publish GPG keypair
- [x] Create a new dedicated CI signing key (NOT a personal key):
  ```bash
  gpg --batch --gen-key <<EOF
  Key-Type: RSA
  Key-Length: 4096
  Subkey-Type: RSA
  Subkey-Length: 4096
  Name-Real: Llamenos Hotline CI
  Name-Email: ci@llamenos-hotline.example.org
  Expire-Date: 2y
  %no-protection
  EOF
  ```
- [x] Export armored private key: `gpg --armor --export-secret-keys <KEY_ID>`
- [x] Store as GitHub repository secret: `RELEASE_GPG_PRIVATE_KEY`
- [x] Store key ID as: `RELEASE_GPG_KEY_ID`
- [x] Export armored public key and publish in `SECURITY.md` (see Phase 4)

### 1.3 Update verify-build.sh to use published public key
- [x] Read `scripts/verify-build.sh`
- [x] Add step to import CI public key automatically (or document it must be imported manually)
- [x] Add GPG_FINGERPRINT constant to the script

---

## Phase 2: Secret Scanning

### 2.1 Add gitleaks configuration
- [x] Create `.gitleaks.toml` at repo root:
  ```toml
  title = "Llamenos Hotline Gitleaks Configuration"

  [extend]
  useDefault = true

  [[rules]]
  # Ignore test keypairs
  id = "llamenos-test-key"
  description = "Test nsec keys (allowed)"
  regex = '''nsec[0-9a-z]{59}'''

  [rules.allowlist]
  regexes = ["nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh"]
  ```
- [x] Create `.github/workflows/secret-scan.yml`:
  ```yaml
  name: Secret Scanning
  on:
    push:
      branches: [main]
    pull_request:
  jobs:
    gitleaks:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with: { fetch-depth: 0 }
        - uses: gitleaks/gitleaks-action@v2
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- [x] Test: run gitleaks locally against full history to ensure no false positives block CI

### 2.2 Verify GitHub Advanced Security (secret scanning) is enabled
- [x] Check repo settings → Security → Secret scanning is enabled
- [x] Enable "Push protection" (blocks commits containing detected secrets)

---

## Phase 3: Dependabot Configuration

### 3.1 Create .github/dependabot.yml
- [x] Create `.github/dependabot.yml`:
  ```yaml
  version: 2
  updates:
    - package-ecosystem: "npm"
      directory: "/"
      schedule:
        interval: "weekly"
        day: "monday"
      open-pull-requests-limit: 5
      groups:
        noble-crypto:
          patterns: ["@noble/*"]
        tanstack:
          patterns: ["@tanstack/*"]
        radix-ui:
          patterns: ["@radix-ui/*"]
      ignore:
        # Only auto-update patch versions for core infra
        - dependency-name: "vite"
          update-types: ["version-update:semver-major"]
        - dependency-name: "hono"
          update-types: ["version-update:semver-major"]

    - package-ecosystem: "cargo"
      directory: "/packages/crypto"
      # NOTE: Before adding this entry, verify the path exists:
      # `ls packages/crypto/Cargo.toml`. If it does not exist, skip the cargo Dependabot entry.
      schedule:
        interval: "weekly"

    - package-ecosystem: "docker"
      directory: "/deploy/docker"
      schedule:
        interval: "weekly"

    - package-ecosystem: "github-actions"
      directory: "/"
      schedule:
        interval: "weekly"
  ```

### 3.2 Configure auto-merge for safe updates
- [x] Create `.github/auto-merge.yml` (or add to dependabot rules):
  - Auto-approve and merge patch updates for non-critical deps
  - Require human review for major version bumps
  - Never auto-merge for: `@noble/*`, `drizzle-orm`, `hono`, `react`

---

## Phase 4: SECURITY.md

- [x] Create `.github/SECURITY.md` (GitHub shows this as "Security Policy"):
  ```markdown
  # Security Policy

  ## Supported Versions

  This project is in pre-production. Security fixes are applied to the `main` branch only.

  ## Reporting a Vulnerability

  **Do not open a GitHub issue for security vulnerabilities.**

  Please report security issues by email to: security@[your-domain] (replace with actual email)

  Include:
  - A description of the vulnerability
  - Steps to reproduce
  - Impact assessment

  We will acknowledge your report within 72 hours and provide a fix timeline.

  ## Disclosure Policy

  We follow a 90-day coordinated disclosure timeline. We will credit reporters
  in release notes unless they prefer to remain anonymous.

  ## CI Release Signing

  All releases are signed. To verify a release:

  1. Import the CI signing key:
     ```bash
     # Public key fingerprint: [INSERT FINGERPRINT AFTER GENERATING]
     gpg --keyserver keys.openpgp.org --recv-keys [FINGERPRINT]
     ```

  2. Run the verification script:
     ```bash
     curl -sL https://github.com/[owner/repo]/raw/main/scripts/verify-build.sh | bash -s v[VERSION]
     ```

  ## Security Features

  - Zero-knowledge architecture: server cannot read call notes or messages
  - E2EE: all sensitive data encrypted client-side
  - Reproducible builds: verify build integrity with CHECKSUMS.txt + GPG signature
  - SLSA Level 2 provenance attestation on all releases
  ```
- [x] Add `SECURITY.md` as a proper file (not just `.github/SECURITY.md` — GitHub shows both)

---

## Phase 5: License Compliance Check (Optional)

- [x] Create `.github/workflows/license-check.yml` (manual trigger only):
  - Run `npx license-checker --summary --failOn GPL-2.0,AGPL-3.0` for Node deps
  - Run `cargo license` for Rust deps
  - Upload report as artifact
- [x] Review any flagged licenses before marking optional

---

## Completion Checklist

- [x] `CHECKSUMS.txt.asc` generated in release job and uploaded to GitHub Release
- [x] `scripts/verify-build.sh` passes signature verification on a test release
- [x] `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_KEY_ID` secrets set in repo
- [x] CI public key fingerprint published in SECURITY.md
- [x] gitleaks: `.gitleaks.toml` created, CI workflow runs on PRs and main
- [x] No false-positive secret alerts (test nsec allowlisted)
- [x] `.github/dependabot.yml` created, auto-update PRs start appearing on Monday
- [x] `.github/SECURITY.md` published (visible at `/security` tab on GitHub)
- [x] Security audit CI job still passes after all changes
