# Watchtower Auto-Update Production Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Watchtower to the production Docker Compose so deployed instances automatically update when new verified images are published to the registry.

**Architecture:** Watchtower runs as a sidecar in docker-compose.production.yml, uses label-based filtering to watch only the app container, authenticates to GHCR via Docker config.json or environment credentials, and runs on a configurable schedule.

**Tech Stack:** Docker Compose, Watchtower (containrrr/watchtower), GHCR (GitHub Container Registry)

---

## Background

The production deployment uses an Ansible-generated Docker Compose (`deploy/ansible/templates/docker-compose.j2`) with the app image set to `{{ llamenos_image }}` (e.g. `ghcr.io/llamenos/llamenos:latest`). The self-hosted `deploy/docker/docker-compose.yml` builds locally, but operators who pull pre-built GHCR images need an automated way to roll in updates without manual SSH sessions.

Watchtower solves this by polling the registry on a schedule and performing a rolling restart of watched containers. We scope it to the `app` container only — postgres, minio, strfry, and caddy must be updated manually to allow for controlled migrations and testing.

## Files to Modify

| File | Change |
|------|--------|
| `deploy/docker/docker-compose.yml` | Add `com.centurylinklabs.watchtower.enable=true` label to `app` service |
| `deploy/docker/docker-compose.production.yml` | Add `watchtower` service |
| `deploy/docker/.env.example` | Document GHCR auth and Watchtower config vars |
| `deploy/ansible/templates/docker-compose.j2` | Add label to `app` service; add `watchtower` service |
| `deploy/ansible/demo_vars.example.yml` | Add `watchtower_enabled`, `watchtower_schedule`, `watchtower_image` vars |
| `deploy/PRODUCTION_CHECKLIST.md` | Add Watchtower health check item |

---

## Tasks

### 1. Label the app service for Watchtower opt-in

- [x] In `deploy/docker/docker-compose.yml`, add a `labels` block to the `app` service:

  ```yaml
  labels:
    com.centurylinklabs.watchtower.enable: "true"
  ```

  This opts only the `app` container in. All other services (postgres, minio, strfry, caddy) remain un-labelled and are never touched by Watchtower.

- [x] In `deploy/ansible/templates/docker-compose.j2`, add the same `labels` block to the `app` service.

### 2. Add the Watchtower service to docker-compose.production.yml

- [x] Append the following service to `deploy/docker/docker-compose.production.yml`:

  ```yaml
  watchtower:
    image: containrrr/watchtower:1.7.1
    restart: unless-stopped
    volumes:
      # Allows Watchtower to manage Docker containers
      - /var/run/docker.sock:/var/run/docker.sock
      # Optional: mount host Docker config for GHCR auth (alternative to env vars)
      # - /root/.docker/config.json:/config.json:ro
    environment:
      # Only watch containers with the watchtower.enable=true label
      - WATCHTOWER_LABEL_ENABLE=true
      # Check interval (seconds). 86400 = every 24 hours.
      - WATCHTOWER_POLL_INTERVAL=${WATCHTOWER_POLL_INTERVAL:-86400}
      # Remove old images after updating
      - WATCHTOWER_CLEANUP=true
      # Log level: info | debug | warn | error | trace
      - WATCHTOWER_LOG_LEVEL=${WATCHTOWER_LOG_LEVEL:-info}
      # GHCR authentication (if image is private)
      # Watchtower reads standard Docker registry env vars:
      - REPO_USER=${GHCR_USERNAME:-}
      - REPO_PASS=${GHCR_TOKEN:-}
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"
  ```

  Notes on the design choices:
  - `WATCHTOWER_LABEL_ENABLE=true` means Watchtower ignores all containers that do not have the `com.centurylinklabs.watchtower.enable=true` label — this is the primary safety gate.
  - `/var/run/docker.sock` is mounted with full access — Watchtower needs write access to the Docker socket to pull images and restart containers.
  - `WATCHTOWER_CLEANUP=true` removes the old image layer after a successful update, preventing disk accumulation on long-running VPS instances.
  - `WATCHTOWER_POLL_INTERVAL` defaults to 86400 (24h). Operators can set a shorter interval (e.g. 3600 for hourly) or switch to webhook-triggered updates (see Optional Enhancements below).

  **Security note:** The Docker socket gives the container significant host access. On hardened deployments, consider using a socket proxy (e.g. `tecnativa/docker-socket-proxy`) to limit which Docker API calls Watchtower can make. This is optional for the current threat model but worth noting in the checklist.

### 3. Add the Watchtower service to the Ansible Jinja2 template

- [x] In `deploy/ansible/templates/docker-compose.j2`, add after the `strfry` service (or at end of services block):

  ```yaml
  {% if watchtower_enabled | default(false) %}
  watchtower:
    image: {{ watchtower_image | default('containrrr/watchtower:1.7.1') }}
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_LABEL_ENABLE=true
      - WATCHTOWER_POLL_INTERVAL={{ watchtower_poll_interval | default(86400) }}
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_LOG_LEVEL=${WATCHTOWER_LOG_LEVEL:-info}
      - REPO_USER=${GHCR_USERNAME:-}
      - REPO_PASS=${GHCR_TOKEN:-}
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "3"
    security_opt:
      - no-new-privileges:true
  {% endif %}
  ```

  The `watchtower_enabled` guard means existing Ansible-managed deployments are not changed unless the operator explicitly opts in. `WATCHTOWER_POLL_INTERVAL` is rendered directly by Ansible (not via shell default expansion) so the `watchtower_poll_interval` var in `demo_vars.example.yml` takes effect.

### 4. Document registry auth and config vars in .env.example

- [x] In `deploy/docker/.env.example`, add a new section:

  ```ini
  # ─── Watchtower (Auto-Updates) ────────────────────────────────
  # Only active when using docker-compose.production.yml.
  # Watchtower watches only the app container (label-enabled filtering).
  #
  # GHCR credentials — required only if the app image is in a private registry.
  # Create a GitHub PAT with read:packages scope:
  #   https://github.com/settings/tokens/new?scopes=read:packages
  # GHCR_USERNAME=your-github-username
  # GHCR_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
  #
  # How often to check for updates (seconds). Default: 86400 (24h).
  # WATCHTOWER_POLL_INTERVAL=86400
  #
  # Log verbosity: info | debug | warn | error
  # WATCHTOWER_LOG_LEVEL=info
  ```

### 5. Add Watchtower vars to demo_vars.example.yml

- [x] In `deploy/ansible/demo_vars.example.yml`, add after the `backup_enabled` line:

  ```yaml
  # ─── Watchtower (Auto-Updates) ──────────────────────────────
  # Enable Watchtower to automatically pull new app images.
  # Set to true on instances where unattended rolling updates are acceptable.
  # Leave false on instances requiring explicit deploy approvals.
  watchtower_enabled: false

  # Watchtower image (pin to a specific release for reproducibility)
  watchtower_image: containrrr/watchtower:1.7.1

  # Check interval in seconds (86400 = 24h, 3600 = 1h).
  # Rendered directly into the generated docker-compose by Ansible — set this var, not an env var.
  watchtower_poll_interval: 86400
  ```

### 6. Add Watchtower health check to PRODUCTION_CHECKLIST.md

- [x] In `deploy/PRODUCTION_CHECKLIST.md`, add a new **Auto-Updates** section after **Health & Monitoring**:

  ```markdown
  ## Auto-Updates (Watchtower)

  - [ ] Watchtower container is running (`docker compose ps watchtower`)
  - [ ] Watchtower log shows it found the app container (`docker compose logs watchtower`)
  - [ ] GHCR credentials set if using a private registry (`GHCR_USERNAME` + `GHCR_TOKEN` in `.env`)
  - [ ] `WATCHTOWER_POLL_INTERVAL` set to an acceptable cadence for your deployment policy
  - [ ] Docker socket mount understood — review security implications if running hardened
  - [ ] Old images cleaned up after update (`WATCHTOWER_CLEANUP=true`)
  ```

### 7. Verify Watchtower starts and sees the app container

- [x] Start the production stack locally with the production override:

  ```bash
  cd deploy/docker
  docker compose -f docker-compose.yml -f docker-compose.production.yml up -d watchtower
  ```

- [x] Confirm Watchtower logs show it discovered the app container:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml logs watchtower
  # Expected: "Found 1 containers with enable label" or similar
  ```

- [x] Confirm no other containers are being watched:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.production.yml logs watchtower | grep -i "watching\|checking\|skipping"
  # postgres, minio, caddy, strfry should appear as skipped/not watched
  ```

- [x] Optionally force a one-shot check to confirm registry auth works (does not restart if image is unchanged):

  ```bash
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -e REPO_USER="${GHCR_USERNAME}" \
    -e REPO_PASS="${GHCR_TOKEN}" \
    containrrr/watchtower:1.7.1 \
    --label-enable --run-once --cleanup
  ```

---

## Optional Enhancements (not in scope for this task)

- **Webhook-triggered updates instead of polling**: Watchtower supports an HTTP API endpoint (`--http-api-update`) so a GitHub Actions workflow can trigger an update on successful image push. This eliminates the polling delay and gives tighter coupling between CI and deploy. Add `WATCHTOWER_HTTP_API_UPDATE=true` and `WATCHTOWER_HTTP_API_TOKEN` env vars and expose the port (only to localhost via Caddy or a firewall rule).
- **Slack/email notifications on update**: Watchtower supports multiple notification backends (`WATCHTOWER_NOTIFICATION_*`). Out of scope here but easy to add.
- **Docker socket proxy**: Replace the raw socket mount with `tecnativa/docker-socket-proxy` scoped to only `GET /containers` and `POST /containers/*/restart` API paths, to limit blast radius if Watchtower is compromised.
- **Image digest pinning in CI**: For tighter security, CI can push a `sha256`-pinned image tag alongside `latest`. Watchtower watches `latest` but each `latest` resolves to a known digest — auditable via `docker inspect`.

---

## Acceptance Criteria

- `docker compose ps watchtower` shows the service running in production stack
- `docker compose logs watchtower` confirms it is watching exactly 1 container (the `app`)
- No other service (postgres, minio, strfry, caddy) appears in Watchtower's watch list
- `.env.example` documents all Watchtower-related variables
- `demo_vars.example.yml` has `watchtower_enabled: false` as the default (opt-in)
- `PRODUCTION_CHECKLIST.md` has an Auto-Updates section with Watchtower items
