# CI Pipeline Hardening & Auto-Deploy — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Scope

This spec covers two related CI concerns that share workflow files:

1. **Security hardening** of the existing CI pipeline: GPG signing of release artifacts, secret scanning, Dependabot, SECURITY.md.
2. **Automated VPS deployment**: triggering the demo VPS deploy automatically when a release is published.

These are grouped because they both modify `.github/workflows/` and must be designed together to avoid conflicts.

---

## Part 1: CI Security Hardening

### Current State

The CI pipeline (`ci.yml`) already has:
- Biome lint, typecheck, Playwright E2E
- CHECKSUMS.txt generation (SHA256 of build artifacts)
- Partial SLSA provenance attestation
- Trivy container scanning
- GitHub Release creation

**Missing:**
- GPG signature of CHECKSUMS.txt (verify-build.sh expects `CHECKSUMS.txt.asc` but it is never produced)
- Secret scanning (no gitleaks or GitHub Advanced Security configured)
- Dependabot (no auto-update PRs)
- SECURITY.md (no security policy published)

### GPG Signing

`scripts/verify-build.sh` already checks for `CHECKSUMS.txt.asc`. CI must produce it.

**Key generation (one-time, operator task):**
```
gpg --batch --gen-key (RSA 4096, Name: Llamenos Hotline CI, no passphrase, 2y expiry)
```
The private key is exported and stored as GitHub secret `RELEASE_GPG_PRIVATE_KEY`. The key ID is stored as `RELEASE_GPG_KEY_ID`. The **public key** is embedded in SECURITY.md and `scripts/verify-build.sh`.

**In `release` job:**
```yaml
- name: Import GPG key
  run: echo "${{ secrets.RELEASE_GPG_PRIVATE_KEY }}" | gpg --batch --import

- name: Sign CHECKSUMS.txt
  run: gpg --batch --armor --local-user "${{ secrets.RELEASE_GPG_KEY_ID }}" --detach-sign CHECKSUMS.txt
  # Produces CHECKSUMS.txt.asc
```
Both `CHECKSUMS.txt` and `CHECKSUMS.txt.asc` must be uploaded to the GitHub Release. Explicitly add `CHECKSUMS.txt.asc` to the `files:` list in the `softprops/action-gh-release` step (alongside `CHECKSUMS.txt`). If only the sign step is added but the `.asc` file is not listed in `files:`, it will not be attached to the release and `verify-build.sh` will silently skip signature verification.

### Secret Scanning (gitleaks)

New workflow `.github/workflows/secret-scan.yml`:
- Triggers on: `push` to `main`, `pull_request`
- Uses `gitleaks/gitleaks-action@v2`
- Config: `.gitleaks.toml` allowlists the test `nsec` key that appears in test fixtures

**Why gitleaks over GitHub Advanced Security only?** GitHub AS requires a paid plan for private repos. gitleaks runs in CI regardless of billing.

### Dependabot

`.github/dependabot.yml` — weekly updates for:
- `npm` (root)
- `cargo` (`/packages/crypto`)
- `docker` (`/deploy/docker`)
- `github-actions`

Groups: `@noble/*`, `@tanstack/*`, `@radix-ui/*` (reduces PR noise).
Ignores major bumps for `vite`, `hono` (require human review).

### SECURITY.md

`.github/SECURITY.md` (GitHub surfaces this at the `/security` tab):
- Supported versions policy
- Vulnerability reporting process (no GitHub Issues; email)
- 90-day coordinated disclosure timeline
- CI signing instructions (import public key, run verify-build.sh)
- Overview of security architecture (pointer to E2EE_ARCHITECTURE.md)

---

## Part 2: Automated VPS Deployment

### Current State

`deploy-demo.yml` is a manually-dispatched workflow. After a GitHub Release is published by CI, the VPS is **not** automatically updated. A human must run `just deploy-demo` or trigger the workflow manually.

### Design

New workflow `.github/workflows/auto-deploy-demo.yml`:

**Trigger:** `release: types: [published]` (fires after `ci.yml` creates the release) + `workflow_dispatch` (for manual override with optional `reset_data` input).

**Concurrency:** `group: deploy-demo, cancel-in-progress: false` — never cancel a running deploy.

**Steps:**
1. Wait for Docker image (built by docker.yml on the tag) to appear in GHCR — poll `docker manifest inspect` up to 10 minutes. If `docker manifest inspect` fails after all retries, the workflow step must exit with code 1 to prevent deploying with a missing or wrong image. Do not fall through to the Ansible step.
2. Checkout at the release tag.
3. Install Ansible + `community.docker` collection.
4. Reconstruct secrets from GitHub environment secrets into temp files.
5. Run `ansible-playbook` with `--extra-vars "image_tag={{ release.tag_name }}"`. The Ansible deploy role must be updated to accept an `image_tag` variable and use it to update the image tag in the templated `docker-compose.yml` (via the Jinja2 template) before starting services. Without this, the role will run `docker compose pull` which pulls `:latest` or whatever tag is already in the template, ignoring the release tag. Add `image_tag` to `vars.example.yml` as an optional override.
6. Optionally run `reset-demo.yml` playbook if `reset_data` input is true.
7. Poll `GET /api/health` until it returns `{"status":"ok"}` (up to 2 minutes).
8. Always clean up temp secret files (`if: always()`).

**Environment:** `demo` (GitHub environment, can require approval if desired later).

**Required secrets:** `DEMO_INVENTORY_YML`, `ANSIBLE_VAULT_PASSWORD`, `DEMO_VARS_YML_ENCRYPTED`, `DEMO_SSH_PRIVATE_KEY`.

### Rollback

In `deploy/ansible/justfile`, add:
```
rollback-demo version:
    ansible-playbook -i inventories/demo.yml playbooks/deploy-demo.yml -e image_tag={{ version }}
```
Documents manual rollback procedure: `just rollback-demo v1.2.3`.

### Relationship to existing deploy-demo.yml

Keep `deploy-demo.yml` for manual dispatches. Extract shared Ansible setup steps into a composite action `.github/actions/ansible-setup/action.yml` to eliminate duplication between the two workflows.

---

## Testing / Verification

**GPG:**
- After next release: verify `CHECKSUMS.txt.asc` is attached to GitHub Release
- Run `scripts/verify-build.sh` against the release — must pass signature check

**Secret scan:**
- Submit a PR with a fake secret → gitleaks blocks it
- Verify the test nsec is allowlisted

**Auto-deploy:**
- Tag a test release → verify auto-deploy-demo.yml triggers, Ansible runs, health check passes

**Dependabot:**
- Verify PRs appear on Monday after enabling
