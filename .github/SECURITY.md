# Security Policy

## Supported Versions

This project is in pre-production. Security fixes are applied to the `main` branch only.

## Reporting a Vulnerability

**Do not open a GitHub issue for security vulnerabilities.**

Please report security issues by creating a [GitHub Security Advisory](../../security/advisories/new)
(the "Report a vulnerability" button on the Security tab), or by emailing the repository maintainer
directly via the contact information in their GitHub profile.

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested mitigations

We will acknowledge your report within 72 hours and provide a fix timeline.

## Disclosure Policy

We follow a 90-day coordinated disclosure timeline. We will credit reporters in release notes
unless they prefer to remain anonymous.

## CI Release Signing

All releases include a `CHECKSUMS.txt` with SHA-256 hashes of all build artifacts, optionally
signed with a dedicated CI GPG key.

To verify a release:

1. Download `CHECKSUMS.txt` and `CHECKSUMS.txt.asc` from the GitHub Release assets.

2. Import the CI signing key (fingerprint published here when signing is enabled):
   ```bash
   # Example (replace FINGERPRINT with actual key fingerprint):
   gpg --keyserver keys.openpgp.org --recv-keys FINGERPRINT
   ```

3. Verify the signature:
   ```bash
   gpg --verify CHECKSUMS.txt.asc CHECKSUMS.txt
   ```

4. Run the full verification script:
   ```bash
   ./scripts/verify-build.sh v[VERSION]
   ```

## Security Features

- **Zero-knowledge architecture**: server cannot read call notes, messages, or transcripts
- **End-to-end encryption**: all sensitive data encrypted client-side before transmission
- **Reproducible builds**: verify build integrity via `CHECKSUMS.txt` + GPG signature
- **SLSA Level 2 provenance**: attestation on all releases via `actions/attest-build-provenance`
- **HMAC-based phone hashing**: phone numbers stored as HMAC-SHA256 hashes, never plaintext
- **Nostr relay communication**: server uses ephemeral Nostr events for real-time messaging; relay cannot distinguish event types
- **Volunteer identity protection**: PII visible only to admins; volunteers cannot see peers' names or phone numbers

## Threat Model

See [`docs/security/THREAT_MODEL.md`](../docs/security/THREAT_MODEL.md) for a full threat model
covering adversary profiles, security boundaries, and design trade-offs.
