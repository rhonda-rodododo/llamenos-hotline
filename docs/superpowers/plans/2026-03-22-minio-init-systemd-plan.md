# MinIO Initialization & Systemd Service Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** (1) Automate MinIO bucket creation, lifecycle policies, and dedicated IAM user on first run. (2) Add systemd service units so Docker Compose starts automatically on host reboot.

**Context:** MinIO container runs but no bucket is auto-created. The app will fail on first file upload. Additionally, there are no systemd units, so a host reboot requires manual `docker compose up -d`.

---

## Part 1: MinIO Initialization

### Phase 1.1: MinIO init script

- [x] Create `deploy/scripts/init-minio.sh`:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  MC="docker exec llamenos-minio mc"
  ALIAS="local"
  BUCKET="${MINIO_BUCKET:-llamenos-files}"
  APP_USER="${MINIO_APP_USER:-llamenos-app}"
  APP_PASS="${MINIO_APP_PASSWORD:?MINIO_APP_PASSWORD must be set}"
  MINIO_URL="http://localhost:9000"  # internal docker network address

  # Wait for MinIO to be ready
  until $MC alias set "$ALIAS" "$MINIO_URL" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" 2>/dev/null; do
    echo "Waiting for MinIO..."
    sleep 2
  done

  # Create bucket if not exists
  $MC mb --ignore-existing "$ALIAS/$BUCKET"

  # Set lifecycle: delete recordings older than 90 days
  $MC ilm rule add --expire-days 90 "$ALIAS/$BUCKET" --prefix "recordings/"

  # Set lifecycle: delete voicemails older than 365 days
  $MC ilm rule add --expire-days 365 "$ALIAS/$BUCKET" --prefix "voicemails/"

  # Create dedicated app IAM user (least-privilege, no root)
  $MC admin user add "$ALIAS" "$APP_USER" "$APP_PASS" || true

  # Create policy for the bucket
  cat > /tmp/llamenos-app-policy.json <<EOF
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        "Resource": ["arn:aws:s3:::${BUCKET}/*"]
      },
      {
        "Effect": "Allow",
        "Action": ["s3:ListBucket"],
        "Resource": ["arn:aws:s3:::${BUCKET}"]
      }
    ]
  }
  EOF
  $MC admin policy create "$ALIAS" llamenos-app /tmp/llamenos-app-policy.json
  $MC admin policy attach "$ALIAS" llamenos-app --user "$APP_USER"

  echo "MinIO initialized successfully."
  ```
- [x] Make executable: `chmod +x deploy/scripts/init-minio.sh`

### Phase 1.2: Add to first-run.sh
- [x] Edit `first-run.sh` (or create if missing):
  - After `docker compose up -d`
  - Add: `bash deploy/scripts/init-minio.sh`
  - Prompt user to set `MINIO_APP_USER` and `MINIO_APP_PASSWORD` if not set

### Phase 1.3: Add to Ansible deploy playbook
- [x] In `deploy/ansible/roles/llamenos/tasks/main.yml`:
  - Add task: Copy `init-minio.sh` to server
  - Add task: Run `init-minio.sh` after container startup
  - The script is idempotent (uses `--ignore-existing` / `|| true` guards), so no `creates:` sentinel is needed — omit the `creates:` clause

### Phase 1.4: Env var updates
- [x] Add `MINIO_APP_USER` and `MINIO_APP_PASSWORD` to:
  - `docker-compose.yml` environment section (app service)
  - `deploy/ansible/demo_vars.example.yml`
  - `src/platform/node/env.ts` — prefer `MINIO_APP_PASSWORD` over root password if set
- [x] Update application MinIO client to use `MINIO_APP_USER`/`MINIO_APP_PASSWORD` instead of root credentials
  - File: `src/platform/node/storage/minio-client.ts` (or equivalent)
  - Fall back to root credentials only in dev

### Phase 1.5: Health check update
- [x] In `GET /api/health`, add MinIO bucket existence check:
  - `headBucket({ Bucket: bucketName })` — returns 404 if not created yet
  - Include in health response: `{ minio: 'ok' | 'bucket_missing' | 'unreachable' }`

---

## Part 2: Systemd Service Integration

### Phase 2.1: Systemd unit file
- [x] Create `deploy/systemd/llamenos.service`:
  ```ini
  [Unit]
  Description=Llamenos Hotline Stack
  Requires=docker.service
  After=docker.service network-online.target
  Wants=network-online.target

  [Service]
  Type=oneshot
  RemainAfterExit=yes
  WorkingDirectory=/opt/llamenos
  ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --remove-orphans
  ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.production.yml down
  TimeoutStartSec=120
  TimeoutStopSec=60

  [Install]
  WantedBy=multi-user.target
  ```

### Phase 2.2: Ansible: install and enable service
- [x] In `deploy/ansible/roles/llamenos/tasks/main.yml`, add tasks:
  ```yaml
  - name: Copy systemd service file
    template:
      src: llamenos.service.j2
      dest: /etc/systemd/system/llamenos.service
      owner: root
      mode: '0644'
    notify: reload systemd

  - name: Enable and start llamenos service
    systemd:
      name: llamenos
      enabled: yes
      state: started
      daemon_reload: yes
  ```
- [x] Create Ansible handler `reload systemd`:
  ```yaml
  - name: reload systemd
    systemd:
      daemon_reload: yes
  ```
- [x] Create `deploy/ansible/templates/llamenos.service.j2`:
  - Same as above but with `{{ deploy_dir }}` Jinja variable for `WorkingDirectory`

### Phase 2.3: Smoke test
- [x] After Ansible deploy, verify:
  - `systemctl is-active llamenos` → active
  - `systemctl is-enabled llamenos` → enabled
  - `docker compose ps` shows all containers up

---

## Completion Checklist

**MinIO:**
- [x] `deploy/scripts/init-minio.sh` creates bucket, lifecycle rules, IAM user
- [x] Script is idempotent (safe to run multiple times)
- [x] Recordings expire after 90 days, voicemails after 365 days
- [x] App uses dedicated IAM user, not root credentials
- [x] `first-run.sh` calls init script
- [x] Ansible runs init script on deploy
- [x] Health endpoint reports MinIO bucket status

**Systemd:**
- [x] `deploy/systemd/llamenos.service` created
- [x] Ansible installs and enables systemd unit
- [x] Stack auto-starts on host reboot
- [x] Service can be managed with `systemctl start/stop/restart llamenos`
