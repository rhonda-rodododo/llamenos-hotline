# Epic 264: CI/CD & Supply Chain Hardening

## Summary
Fix 8 CI/CD and deployment vulnerabilities from Audit Round 8: macOS keychain empty password (H19), Play Store action not pinned (H20), dtolnay/rust-toolchain not pinned (H21), strfry image not pinned (H22), bun audit threshold (M32), dev HMAC_SECRET (misc), update manifest generation (misc), and Ansible SSH defaults (misc).

## Context
- **Audit Round**: 8 (March 2026)
- **Severity**: 4 High, 4 Medium
- Supply chain integrity is critical for a security-focused app
- Most issues are configuration-only changes

## Implementation

### H19: Fix macOS Keychain Password

**`.github/workflows/tauri-release.yml`**:
```yaml
- name: Install Apple certificate
  run: |
    KEYCHAIN_PASSWORD=$(openssl rand -hex 16)
    echo "::add-mask::$KEYCHAIN_PASSWORD"
    security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    security set-key-partition-list -S apple-tool:,apple:,codesign: \
      -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
```

### H20: Pin Play Store Upload Action

**`.github/workflows/mobile-release.yml`**:
```yaml
uses: r0adkll/upload-google-play@<full-sha> # v1
```

### H21: Pin dtolnay/rust-toolchain

All 5 workflow files:
```yaml
uses: dtolnay/rust-toolchain@<full-sha> # stable
```

Files: `ci.yml`, `tauri-release.yml`, `desktop-e2e.yml`, `mobile-release.yml` (2x)

### H22: Pin strfry Image to Digest

**`deploy/docker/docker-compose.yml`**:
```yaml
image: dockurr/strfry:1.0.1@sha256:<digest>
```

Also pin whisper image if digest available.

### M32: Improve Audit Threshold

**`.github/workflows/ci.yml`**:
```yaml
- name: Security audit
  run: |
    # Known high-severity vulns in transitive dev deps (reviewed 2026-03-05)
    # Next review: 2026-04-05
    bun audit --audit-level=high || {
      echo "::warning::High-severity vulns found"
      bun audit --audit-level=critical
    }
```

### Misc: Fix generate-update-manifest.sh Fallback

```bash
NOTES_ESCAPED=$(echo -n "$NOTES" | jq -Rs . 2>/dev/null || echo '""')
```

### Misc: Fix Ansible SSH Default

**`deploy/ansible/vars.example.yml`**:
```yaml
ssh_allowed_cidrs:
  - "REPLACE_WITH_YOUR_IP/32"  # REQUIRED
```

### Misc: Improve dev HMAC_SECRET

**`scripts/dev-node.sh`**:
```bash
if [ -z "$HMAC_SECRET" ]; then
  echo "WARNING: HMAC_SECRET not set. Generating random value."
  export HMAC_SECRET=$(openssl rand -hex 32)
fi
```

## Tests

### CI Validation
- Verify pinned SHAs resolve correctly
- Verify `bun audit` step behavior
- Verify macOS signing with random keychain password

### Docker Compose
- `docker compose config` validates after digest pinning
- strfry starts correctly with digest-pinned image

## Files to Modify
| File | Action |
|------|--------|
| `.github/workflows/tauri-release.yml` | Fix keychain, scope signing key |
| `.github/workflows/mobile-release.yml` | Pin Play Store action |
| `.github/workflows/ci.yml` | Pin rust-toolchain, improve audit |
| `.github/workflows/desktop-e2e.yml` | Pin rust-toolchain |
| `deploy/docker/docker-compose.yml` | Pin strfry + whisper digests |
| `scripts/generate-update-manifest.sh` | Use jq for JSON encoding |
| `deploy/ansible/vars.example.yml` | Fix SSH CIDR default |
| `scripts/dev-node.sh` | Generate random HMAC_SECRET |

## Dependencies
- Action SHA pinning requires looking up current commit hashes
- Docker digest pinning requires pulling images to get digests
- No code changes — all configuration
