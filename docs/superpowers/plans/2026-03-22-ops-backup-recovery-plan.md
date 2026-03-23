# PostgreSQL Backup & Recovery Procedures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement automated PostgreSQL backups to S3-compatible storage (Backblaze B2 / MinIO), test restoration procedures, and add monitoring alerts for backup failures.

**Current state:** `deploy/ansible/roles/backup/` exists and is referenced in `playbooks/backup.yml`. This plan verifies completeness and fills gaps.

---

## Phase 1: Audit Current Backup Setup

- [x] Read `deploy/ansible/roles/backup/` — all tasks, templates, defaults
- [x] Read `deploy/ansible/playbooks/backup.yml`
- [x] Read `deploy/ansible/playbooks/test-restore.yml`
- [x] Document:
  - Current backup method (pg_dump? pg_basebackup?)
  - Schedule (cron? systemd timer?)
  - Retention (how many backups kept?)
  - Storage target (Backblaze B2? MinIO?)
  - Encryption at rest?
  - Test restore procedure

---

## Phase 2: Backup Implementation (if incomplete)

### 2.1 Automated backup script
If `deploy/ansible/roles/backup/` is incomplete:

- [x] Create `deploy/scripts/backup-postgres.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  BACKUP_FILE="llamenos-$(date +%Y%m%d-%H%M%S).sql.gz.age"
  pg_dump "$DATABASE_URL" | gzip | age -r "$BACKUP_PUBLIC_KEY" > "/tmp/${BACKUP_FILE}"
  s3cmd put "/tmp/${BACKUP_FILE}" "s3://${BACKUP_BUCKET}/backups/${BACKUP_FILE}"
  rm "/tmp/${BACKUP_FILE}"
  ```
- [x] Use `age` (FiloSottile/age) for encryption with the operator's public key
  - Key stored in Ansible vars: `backup_public_key`
  - Private key held offline by org security officer
- [x] Upload to Backblaze B2 via `s3cmd` or `rclone` (already in Ansible)

### 2.2 Backup scheduling
- [x] Add systemd timer to Ansible role:
  - `llamenos-backup.service` — runs backup script
  - `llamenos-backup.timer` — `OnCalendar=*-*-* 03:00:00 UTC` (daily at 3am)
  - `OnBootSec=5min` (run 5 min after boot in case server was down at 3am)
- [x] Deploy via Ansible role task

### 2.3 Retention policy
- [x] Keep 7 daily backups, 4 weekly backups, 3 monthly backups (Grandfather-Father-Son)
- [x] Add script to prune old backups from S3 after upload

### 2.4 Backup encryption
- [x] Use `age` with recipient public key (not password-based)
  - Public key stored in: `deploy/ansible/group_vars/all.yml` (non-secret)
  - Private key stored offline by org security officer (never in repo)
- [x] Verify: backup files in S3 are encrypted; no plaintext PG dumps ever touch S3

---

## Phase 3: Restoration Procedure

### 3.1 Restore script
- [x] Create `deploy/scripts/restore-postgres.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  BACKUP_FILE="$1"  # s3://bucket/backups/llamenos-20260101-030000.sql.gz.age
  s3cmd get "$BACKUP_FILE" /tmp/restore.sql.gz.age
  age -d -i "$AGE_PRIVATE_KEY_FILE" /tmp/restore.sql.gz.age | gunzip | psql "$DATABASE_URL"
  rm /tmp/restore.sql.gz.age
  ```
- [x] Document: requires AGE_PRIVATE_KEY_FILE (offline private key path)

### 3.2 Test restore Ansible playbook
- [x] Verify `playbooks/test-restore.yml` exists and:
  - Downloads latest backup from S3
  - Restores to a separate test database (not production!)
  - Runs basic queries to verify data integrity (`SELECT COUNT(*) FROM volunteers`)
  - Reports success/failure
- [x] Run monthly via CI job or manual trigger: `just test-restore-demo`

### 3.3 Restore runbook documentation
- [x] Create `docs/ops/restore-runbook.md`:
  - Step-by-step instructions for restoring from backup in an emergency
  - Who holds the AGE private key
  - How to verify backup integrity before restoring
  - How to handle partial/corrupt backups

---

## Phase 4: Monitoring & Alerting

### 4.1 Backup success monitoring
- [x] After each backup, write a "last successful backup" timestamp to a health-check endpoint or monitoring file
- [x] Surface backup freshness via the health endpoint (see 4.3) — do NOT add a Prometheus exporter; the project has no Prometheus setup
- [x] Alert: if last successful backup is older than 25 hours, trigger alert (Slack/PagerDuty via Ansible monitoring setup)

### 4.2 Backup size monitoring
- [x] Log backup file size after each run
- [x] Alert if backup size drops significantly (>50% smaller than previous) — could indicate data loss

### 4.3 Add to health endpoint
- [x] Add backup status to `GET /health` response:
  ```json
  {
    "status": "ok",
    "backup": {
      "lastSuccessAt": "2026-03-22T03:00:00Z",
      "lastSizeBytes": 1234567
    }
  }
  ```

---

## Phase 5: Drizzle Migration Backup Consideration

- [x] Before running the Drizzle migration (`cf-removal-drizzle-migration-plan.md`), take a manual full backup
- [x] Document in the migration plan: "Step 0: Run `just backup-demo` before any schema changes"
- [x] Add rollback instruction: if migration fails, restore from pre-migration backup

---

## Ansible Justfile Additions

- [x] Add to `deploy/ansible/justfile`:
  ```
  backup-demo:
      ansible-playbook -i inventory.yml playbooks/backup.yml --limit demo

  test-restore-demo:
      ansible-playbook -i inventory.yml playbooks/test-restore.yml --limit demo

  restore-demo backup_file:
      ansible-playbook -i inventory.yml playbooks/restore.yml --limit demo -e backup_file={{ backup_file }}
  ```

---

## Completion Checklist

- [x] `backup-postgres.sh` script working with `age` encryption
- [x] Daily backup scheduled (systemd timer)
- [x] Backups land in S3-compatible storage (Backblaze B2)
- [x] GFS retention policy deletes old backups automatically
- [x] `restore-postgres.sh` tested successfully with a real backup
- [x] `playbooks/test-restore.yml` runs without errors
- [x] `docs/ops/restore-runbook.md` written
- [x] Backup freshness exposed via health endpoint (no Prometheus — out of scope)
- [x] Justfile recipes added: `backup-demo`, `test-restore-demo`, `restore-demo`
- [x] Pre-migration backup documented in Drizzle migration plan
