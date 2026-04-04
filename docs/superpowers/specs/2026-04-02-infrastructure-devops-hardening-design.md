# Spec: Infrastructure & DevOps Hardening

**Date:** 2026-04-02
**Priority:** High (Production Readiness)
**Status:** Draft

## Overview

Five infrastructure gaps identified during audit: RustFS blob storage not backed up, no backup failure alerting, container images not fully digest-pinned, no Prometheus alerting rules, and Watchtower missing production safeguards.

---

## Issue 1: RustFS Blob Storage Not Backed Up

### Problem

The backup script (`deploy/ansible/roles/backup/tasks/main.yml`) only backs up PostgreSQL. RustFS blob storage (`rustfs-data` volume) containing voicemail recordings, encrypted file uploads, and attachment data is not included.

### Impact

If the RustFS volume is lost, all uploaded files and voicemail recordings are permanently gone. PostgreSQL has metadata/references but the actual binary data lives only in RustFS.

### Fix

Add RustFS backup to the Ansible backup role:
1. Use `mc` (MinIO client) or `rclone` to dump all RustFS buckets to a tarball
2. Encrypt with `age` (same key as PostgreSQL backup)
3. Include in retention policy (same schedule: 7 daily, 4 weekly, 3 monthly)
4. Update `.status.json` to include RustFS backup size

### Considerations
- RustFS data may be large (recordings, attachments) — consider incremental/differential backup
- All blob data is already E2EE — backup encryption is defense-in-depth
- Backup should not lock RustFS (use S3 API listing + GET, not volume-level snapshot)

---

## Issue 2: No Backup Failure Alerting

### Problem

Backup status is tracked in `/var/data/backup-status.json` and exposed via the `/api/health` endpoint, but there is no alerting when:
- Backup hasn't run for >25 hours (missed daily cron)
- Backup failed (no status update)
- Backup size dropped significantly (potential data loss)

### Fix

1. Add `llamenos_backup_age_seconds` gauge to `src/server/routes/metrics.ts` — calculated from `.status.json` `lastSuccessAt`
2. Create Prometheus alerting rules in Helm chart (`deploy/helm/llamenos/templates/prometheusrule.yaml`):
   - `BackupTooOld` — fires when backup age > 25 hours
   - `BackupSizeAnomaly` — fires when size drops >50% vs previous
3. For Docker Compose (non-k8s): add simple cron health check script that emails/Slacks on failure

---

## Issue 3: Container Images Not Fully Digest-Pinned

### Problem

Several production images use mutable tags instead of SHA256 digests:

| Service | Current | Status |
|---------|---------|--------|
| Authentik | `ghcr.io/goauthentik/server:2025.12` | **Not pinned** |
| Whisper | `fedirz/faster-whisper-server:0.4.1` | **Not pinned** (TODO in code) |
| RustFS | `rustfs/rustfs:latest` | **Floating tag** |
| Strfry (Helm) | `dockurr/strfry:latest` | **Floating tag** (pinned in Docker Compose) |

### Fix

1. Look up current digest for each image
2. Pin all images to `image@sha256:...` format in both `docker-compose.yml` and `values.yaml`
3. Document the pinned versions in a comment for future updates

---

## Issue 4: No Prometheus Alerting Rules

### Problem

ServiceMonitor exists for scraping but no PrometheusRule resource defines alerts. The metrics endpoint (`src/server/routes/metrics.ts`) only exposes `llamenos_uptime_seconds` — no request-level or application-level metrics.

### Fix

1. Add application metrics to `src/server/routes/metrics.ts`:
   - `llamenos_http_requests_total` (counter, labels: method, path, status)
   - `llamenos_http_request_duration_seconds` (histogram)
   - `llamenos_active_calls` (gauge)
   - `llamenos_backup_age_seconds` (gauge)
2. Create `deploy/helm/llamenos/templates/prometheusrule.yaml` with alerts:
   - `LlamenosDown` — target down for >5 minutes
   - `BackupTooOld` — backup age >25 hours
   - `HighErrorRate` — >5% 5xx responses in 5 minutes
   - `HighLatency` — p95 latency >2s in 5 minutes

---

## Issue 5: Watchtower Production Safeguards

### Problem

Watchtower config in `docker-compose.production.yml` is functional but missing:
- Scheduled update windows (updates can happen during active calls)
- Failure notifications (no webhook for Slack/email)
- Dry-run mode for staged rollouts

### Fix

1. Add `WATCHTOWER_SCHEDULE` with cron expression for off-hours (e.g., `0 0 4 * * *` = 04:00 UTC daily)
2. Add webhook notification URL: `WATCHTOWER_NOTIFICATION_URL` for Slack/Discord/email
3. Document dry-run mode: `WATCHTOWER_DRY_RUN=true` for testing
4. Add `WATCHTOWER_LIFECYCLE_HOOKS` for pre/post-update health checks

---

## Testing Strategy

- Backup changes: test in VM E2E environment (`deploy/ansible/playbooks/backup.yml` → `test-restore.yml`)
- Metrics: verify at `/api/metrics` after server restart
- Image pinning: `docker compose config` to verify resolved images
- Alerting rules: `promtool check rules prometheusrule.yaml`
