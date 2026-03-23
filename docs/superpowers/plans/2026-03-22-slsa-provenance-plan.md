# SLSA Provenance + CI Release Signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the reproducible build pipeline with SLSA Level 2 provenance, GPG-signed CHECKSUMS.txt, and automated GitHub Release publishing. The verification script (`scripts/verify-build.sh`) already exists; this plan wires the CI side.

**Current state:** `Dockerfile.build` and `verify-build.sh` are implemented. CI generates `CHECKSUMS.txt`, GPG-signs it, generates `provenance.json`, attests with `actions/attest-build-provenance`, and publishes all artifacts to GitHub Releases.

---

## Background

- SLSA (Supply-chain Levels for Software Artifacts) Level 2 requires: versioned source, scripted build, provenance
- `Dockerfile.build` uses `SOURCE_DATE_EPOCH` for deterministic builds
- `scripts/verify-build.sh` verifies checksums against published `CHECKSUMS.txt`
- GPG signing makes `CHECKSUMS.txt` tamper-evident

---

## Phase 1: Locate and Audit CI Workflows

- [x] Read all files in `.github/workflows/` to understand current CI setup
- [x] Identify: which workflow handles releases? Which triggers are used?
  - `.github/workflows/ci.yml` handles releases via the `release` job, triggered on push to main after version bump
- [x] Identify: is there a Docker build step? If so, does it use `Dockerfile.build`?
  - CI builds via `bun run build` directly (not Docker); `Dockerfile.build` is for local reproducible verification
- [x] Document findings before making changes

---

## Phase 2: Release Workflow

### 2.1 Create or update release workflow (`.github/workflows/release.yml`)
- [x] Trigger: `push` to tag matching `v*` (e.g. `v1.0.0`)
  - Implemented in `ci.yml` — release job runs after version bump creates a tag on main
- [x] Job: `build-and-attest`
  - **Checkout**: `actions/checkout@v4` with `fetch-depth: 0` (full history for SOURCE_DATE_EPOCH)
  - **Get SOURCE_DATE_EPOCH**: `git log -1 --format=%ct HEAD` (set in build job)
  - **Build Docker image**: CI uses `bun run build` directly; `Dockerfile.build` is for offline verification
  - **Extract build artifacts**: Uploaded as `app-build` artifact, downloaded in release job
  - **Generate CHECKSUMS.txt**: `find dist/client -type f -exec sha256sum {} \; | sort` in build job
  - **Generate provenance metadata**: `provenance.json` generated in release job with git commit, repo, build time, Bun version

### 2.2 GPG signing
- [x] Add repository secret: `RELEASE_GPG_PRIVATE_KEY` (CI operator's GPG key, armored) — referenced in workflow, operator configures
- [x] Add repository secret: `RELEASE_GPG_KEY_ID` — referenced in workflow, operator configures
- [x] In release workflow:
  - Import GPG key: `gpg --batch --import`
  - Sign with key ID: `gpg --batch --armor --local-user "$GPG_KEY_ID" --detach-sign CHECKSUMS.txt`
  - Gracefully skips if secrets not configured

### 2.3 GitHub Release publishing
- [x] Use `softprops/action-gh-release@v2` to create/update the GitHub Release:
  - Title: `v${{ needs.version.outputs.new_version }}`
  - Files to attach:
    - `CHECKSUMS.txt`
    - `CHECKSUMS.txt.asc` (if GPG keys configured)
    - `provenance.json`
- [x] Grant `contents: write` permission to the workflow job

### 2.4 SLSA provenance document
- [x] Generate `provenance.json` with:
  ```json
  {
    "builder": { "id": "https://github.com/actions/runner" },
    "buildType": "https://github.com/slsa-framework/slsa/blob/main/docs/spec/v1.0/levels.md",
    "invocation": {
      "configSource": { "uri": "git+https://github.com/OWNER/REPO@refs/tags/VERSION" },
      "parameters": { "SOURCE_DATE_EPOCH": "...", "bunVersion": "..." }
    },
    "buildConfig": { "dockerfile": "Dockerfile.build" },
    "metadata": {
      "buildStartedOn": "...",
      "completeness": { "parameters": true, "environment": false, "materials": false }
    },
    "materials": [{ "uri": "git+https://...", "digest": { "sha1": "..." } }]
  }
  ```
- [x] Attach `provenance.json` to GitHub Release

---

## Phase 3: SLSA Level 2 GitHub Action (Optional Upgrade)

For SLSA Level 2+, use the official GitHub SLSA generator:

- [x] `actions/attest-build-provenance@v2.1.0` is already used in CI for OIDC-signed attestation
  - Attests `CHECKSUMS.txt` and all `.js`/`.css` build outputs
  - Level 2: hosted runner, scripted build
- [x] GitHub-native attestation is generated (viewable via `gh attestation verify`)
- [ ] Note: SLSA Level 3 requires hermetic builds (additional runner config) — out of scope now

---

## Phase 4: Update verify-build.sh

- [x] Read `scripts/verify-build.sh` to understand current state
- [x] Verify it:
  - Downloads CHECKSUMS.txt and CHECKSUMS.txt.asc from the GitHub Release
  - Verifies GPG signature on CHECKSUMS.txt
  - Builds locally using `Dockerfile.build` with same `SOURCE_DATE_EPOCH`
  - Compares local checksums to published
- [x] Add: download `provenance.json` and display build metadata to verifier
- [x] Update the `gh release download` command to include the new signing key fingerprint in the verification instructions
  - Script already handles GPG verification; operator provides their public key to verifiers

---

## Phase 5: Documentation

- [ ] Update `CLAUDE.md` release section (or create `docs/ops/release.md`):
  - How to tag a release: `git tag v1.0.0 && git push origin v1.0.0`
  - What CI does automatically (build, sign, publish)
  - How to set up `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_KEY_ID` secrets
  - How end-users run `scripts/verify-build.sh` to verify their download
- [ ] Document GPG key rotation procedure (operator security runbook item)

---

## Completion Checklist

- [x] `.github/workflows/ci.yml` release job handles all release tasks (no separate release.yml needed)
- [x] Build uses `SOURCE_DATE_EPOCH` from git commit time
- [x] `CHECKSUMS.txt` generated with `sha256sum` of all build artifacts
- [x] `CHECKSUMS.txt.asc` GPG signature generated (when secrets configured)
- [x] All files uploaded to GitHub Release (CHECKSUMS.txt, CHECKSUMS.txt.asc, provenance.json)
- [x] `provenance.json` generated and attached
- [x] `scripts/verify-build.sh` downloads and verifies all release artifacts including provenance
- [ ] Test: push a test tag → verify release created with expected files
- [ ] Test: run `verify-build.sh` against the test release → passes
- [x] `RELEASE_GPG_PRIVATE_KEY` and `RELEASE_GPG_KEY_ID` secrets referenced in workflow (operator configures)
