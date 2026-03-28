# Plan: IdP Auth — Deployment Config Updates

**Status**: Not started
**Branch**: feat/idp-auth-hardening
**Context**: The IdP auth migration adds JWT sessions, Authentik IdP, multi-factor KEK derivation (PIN + IdP + WebAuthn PRF), and a crypto Web Worker. Deployment configs need new env vars, services, and secret generation.

## Overview

All deployment methods (Docker, Ansible, Helm, Co-op Cloud) need:
1. New env vars for JWT, IdP, WebAuthn
2. Authentik as a core service
3. Secret generation for new keys
4. Updated storage refs (MinIO → RustFS where missed)

## New Environment Variables

| Variable | Required | Generation | Description |
|----------|----------|------------|-------------|
| `JWT_SECRET` | Yes | `openssl rand -hex 32` | Signs JWT access/refresh tokens |
| `IDP_VALUE_ENCRYPTION_KEY` | Yes | `openssl rand -hex 32` | Encrypts IdP-bound values at rest |
| `IDP_VALUE_KEY_VERSION` | No | Default `1` | Key version for rotation |
| `IDP_ADAPTER` | No | Default `authentik` | IdP provider (`authentik`, `oidc-generic`) |
| `AUTHENTIK_URL` | Yes | Instance URL | Authentik internal URL (e.g. `http://authentik-server:9000`) |
| `AUTHENTIK_API_TOKEN` | Yes | Bootstrap token | Authentik API token for user provisioning |
| `AUTHENTIK_SECRET_KEY` | Yes | `openssl rand -hex 32` | Authentik internal secret (>=50 chars) |
| `AUTHENTIK_BOOTSTRAP_TOKEN` | Yes | `openssl rand -hex 32` | Initial admin API token |
| `AUTH_WEBAUTHN_RP_ID` | No | Default: domain | WebAuthn Relying Party ID |
| `AUTH_WEBAUTHN_RP_NAME` | No | Default: `Llamenos` | WebAuthn RP display name |
| `AUTH_WEBAUTHN_ORIGIN` | No | Default: `https://<domain>` | WebAuthn origin for credential verification |

## Tasks

### 1. scripts/docker-setup.sh
- [ ] Replace `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` with `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`
- [ ] Add generation for: `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `AUTHENTIK_SECRET_KEY`, `AUTHENTIK_BOOTSTRAP_TOKEN`
- [ ] Add env var writes to .env: `IDP_ADAPTER`, `AUTHENTIK_URL`, `AUTH_WEBAUTHN_RP_ID`, `AUTH_WEBAUTHN_RP_NAME`, `AUTH_WEBAUTHN_ORIGIN`
- [ ] Update the `--domain` flag handler to set `AUTH_WEBAUTHN_RP_ID` and `AUTH_WEBAUTHN_ORIGIN` from domain
- [ ] Add Authentik health wait after `docker compose up` (similar to postgres wait)

### 2. deploy/ansible/roles/llamenos/templates/env.j2
- [ ] Add "IdP Auth" section with all new vars (JWT_SECRET, IDP_*, AUTHENTIK_*, AUTH_WEBAUTHN_*)
- [ ] Update "Identity & Auth" section header/comments

### 3. deploy/ansible/demo_vars.example.yml
- [ ] Verify all new vars are documented (check shows they already are — confirm complete)

### 4. deploy/ansible/roles/llamenos/tasks/main.yml
- [ ] Add Authentik blueprints directory copy task (if blueprints are file-mounted)
- [ ] Ensure Authentik health check in deploy sequence

### 5. deploy/helm/llamenos/values.yaml
- [ ] Add `idp` config section: `enabled`, `adapter`, `authentik.url`, `authentik.secretKey`, `webauthn.rpId`, `webauthn.rpName`, `webauthn.origin`
- [ ] Add `auth.jwtSecret`, `auth.idpValueEncryptionKey` to secrets section

### 6. deploy/helm/llamenos/templates/secret.yaml
- [ ] Add secret data entries: `jwt-secret`, `idp-value-encryption-key`, `authentik-secret-key`, `authentik-api-token`

### 7. deploy/helm/llamenos/templates/deployment-app.yaml
- [ ] Add env vars from secrets: `JWT_SECRET`, `IDP_VALUE_ENCRYPTION_KEY`, `IDP_ADAPTER`, `AUTHENTIK_URL`, `AUTHENTIK_API_TOKEN`, `AUTH_WEBAUTHN_*`

### 8. deploy/docker/.env.example
- [ ] Verify complete (audit shows it's good — confirm no missing vars)

### 9. .github/workflows/ci.yml
- [ ] Verify Authentik service container is started for integration/E2E tests
- [ ] Verify all test env vars present (audit shows TEST_JWT_SECRET and TEST_IDP_VALUE_ENCRYPTION_KEY are set)

## Acceptance Criteria
- `scripts/docker-setup.sh` generates all required secrets and starts Authentik
- Ansible deploys with IdP auth configured
- Helm chart installs with IdP secrets
- CI passes with Authentik service
- No MinIO references remain in any deployment config
