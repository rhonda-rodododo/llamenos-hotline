# SLSA Provenance + CI Release Signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the reproducible build pipeline with SLSA Level 2 provenance, GPG-signed CHECKSUMS.txt, and automated GitHub Release publishing. The verification script (`scripts/verify-build.sh`) already exists; this plan wires the CI side.

**Current state:** `Dockerfile.build` and `verify-build.sh` are implemented. CI does not yet: build the Docker image, generate `CHECKSUMS.txt`, GPG-sign it, or publish to GitHub Releases.

---

## Background

- SLSA (Supply-chain Levels for Software Artifacts) Level 2 requires: versioned source, scripted build, provenance
- `Dockerfile.build` uses `SOURCE_DATE_EPOCH` for deterministic builds
- `scripts/verify-build.sh` verifies checksums against published `CHECKSUMS.txt`
- GPG signing makes `CHECKSUMS.txt` tamper-evident

---

## Phase 1: Locate and Audit CI Workflows

- [ ] Read all files in `.github/workflows/` to understand current CI setup
- [ ] Identify: which workflow handles releases? Which triggers are used?
- [ ] Identify: is there a Docker build step? If so, does it use `Dockerfile.build`?
- [ ] Document findings before making changes

---

## Phase 2: Release Workflow

### 2.1 Create or update release workflow (`.github/workflows/release.yml`)
- [ ] Trigger: `push` to tag matching `v*` (e.g. `v1.0.0`)
- [ ] Job: `build-and-attest`
  - **Checkout**: `actions/checkout@v4` with `fetch-depth: 0` (full history for SOURCE_DATE_EPOCH)
  - **Get SOURCE_DATE_EPOCH**: `git log -1 --format=%ct HEAD`
  - **Build Docker image**: `docker build --build-arg SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH -f Dockerfile.build -t llamenos-build .`
  - **Extract build artifacts**: Copy `dist/client/` out of the Docker image
  - **Generate CHECKSUMS.txt**: `find dist/client -type f | sort | xargs sha256sum > CHECKSUMS.txt`
  - **Generate provenance metadata**: Include git commit, branch, build time, Bun version, Node version

### 2.2 GPG signing
- [ ] Add repository secret: `RELEASE_GPG_PRIVATE_KEY` (CI operator's GPG key, armored)
- [ ] Add repository secret: `RELEASE_GPG_KEY_ID`
- [ ] In release workflow:
  - Import GPG key: `gpg --import <<< "${{ secrets.RELEASE_GPG_PRIVATE_KEY }}"`
  - Sign: `gpg --armor --detach-sign CHECKSUMS.txt` → produces `CHECKSUMS.txt.asc`
  - Sign with key ID: `gpg --armor --local-user ${{ secrets.RELEASE_GPG_KEY_ID }} --detach-sign CHECKSUMS.txt`

### 2.3 GitHub Release publishing
- [ ] Use `softprops/action-gh-release@v2` to create/update the GitHub Release:
  - Title: `${{ github.ref_name }}`
  - Files to attach:
    - `CHECKSUMS.txt`
    - `CHECKSUMS.txt.asc`
    - `dist/client.tar.gz` (build artifact archive)
    - `provenance.json` (see 2.4)
- [ ] Grant `contents: write` permission to the workflow job

### 2.4 SLSA provenance document
- [ ] Generate `provenance.json` with:
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
- [ ] Attach `provenance.json` to GitHub Release

---

## Phase 3: SLSA Level 2 GitHub Action (Optional Upgrade)

For SLSA Level 2+, use the official GitHub SLSA generator:

- [ ] Add `slsa-framework/slsa-github-generator` workflow (`.github/workflows/slsa.yml`):
  - Generates provenance using the signed OIDC token (no GPG key needed)
  - Level 2: hosted runner, scripted build
- [ ] This runs as a separate job, producing a `provenance.intoto.jsonl` file
- [ ] Attach to GitHub Release alongside CHECKSUMS.txt
- [ ] Note: SLSA Level 3 requires hermetic builds (additional runner config) — out of scope now

---

## Phase 4: Update verify-build.sh

- [ ] Read `scripts/verify-build.sh` to understand current state
- [ ] Verify it:
  - Downloads CHECKSUMS.txt and CHECKSUMS.txt.asc from the GitHub Release
  - Verifies GPG signature on CHECKSUMS.txt
  - Builds locally using `Dockerfile.build` with same `SOURCE_DATE_EPOCH`
  - Compares local checksums to published
- [ ] Add: download `provenance.json` and display build metadata to verifier
- [ ] Update the `gh release download` command to include the new signing key fingerprint in the verification instructions

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

- [ ] `.github/workflows/release.yml` created and triggers on `v*` tags
- [ ] Docker build uses `Dockerfile.build` with `SOURCE_DATE_EPOCH` from git
- [ ] `CHECKSUMS.txt` generated with `sha256sum` of all build artifacts
- [ ] `CHECKSUMS.txt.asc` GPG signature generated
- [ ] Both files uploaded to GitHub Release
- [ ] `provenance.json` generated and attached
- [ ] `scripts/verify-build.sh` downloads and verifies the new files
- [ ] Test: push a test tag → verify release created with expected files
- [ ] Test: run `verify-build.sh` against the test release → passes
- [ ] `RELEASE_GPG_PRIVATE_KEY` secret documented in deployment runbook
