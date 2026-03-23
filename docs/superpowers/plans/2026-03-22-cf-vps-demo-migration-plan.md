# CF → VPS Demo Migration — Implementation Plan

**Date:** 2026-03-22
**Spec:** docs/superpowers/specs/2026-03-22-cf-vps-demo-migration-design.md
**Status:** Complete

---

## Key Findings from Codebase Exploration

1. **Reset endpoint is `POST /api/test-reset`** (not `/api/dev/reset` as spec says). Header is `X-Test-Secret` (not `X-Dev-Reset-Secret`). The `DEV_RESET_SECRET` env var gates it.
2. **The endpoint is gated by `ENVIRONMENT === 'development'`** — must add `'demo'` as an allowed value (Option A).
3. **No active CF Workers deploy job in `ci.yml`** — the header comment referencing it is stale. Only comment updates are needed, not job removal.
4. **`deploy` script** currently runs `deploy:demo && deploy:site` — must be updated to `deploy:site` only.

---

## Step 1 — Fix Reset Endpoint Environment Guard

**File:** `src/worker/routes/dev.ts`

The endpoint guard currently checks `c.env.ENVIRONMENT !== 'development'`. Add `'demo'` alongside it:

```typescript
// Before (example — find actual line):
if (c.env.ENVIRONMENT !== 'development') {
  return c.json({ error: 'Not available' }, 404)
}

// After:
if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'demo') {
  return c.json({ error: 'Not available' }, 404)
}
```

Apply this change on all occurrences in `dev.ts` where the environment check gates reset/dev endpoints (typically 2–3 occurrences).

**Verify:** `bun run typecheck` passes.

---

## Step 2 — Update `deploy/ansible/inventory.example.yml`

**File to modify:** `deploy/ansible/inventory.example.yml`

Restructure to use named host groups so production and demo can use separate inventory files:

```yaml
# Llamenos Ansible Inventory
#
# For production: cp inventory.example.yml inventory.yml && edit
# For demo: cp inventory.example.yml inventory-demo.yml && edit
#
# Both files can coexist — pass with -i flag:
#   just setup-all                    # uses inventory.yml (production)
#   just deploy-demo -i inventory-demo.yml

all:
  children:
    production:
      hosts:
        llamenos:
          ansible_host: 203.0.113.10
          ansible_user: deploy
          ansible_ssh_private_key_file: ~/.ssh/llamenos_deploy
          ansible_port: 22
          # For CI dry-run validation only:
          ansible_connection: local

    demo:
      hosts:
        demo-vps:
          ansible_host: 5.6.7.8
          ansible_user: deploy
          ansible_ssh_private_key_file: ~/.ssh/llamenos_demo_deploy
          ansible_port: 22
```

---

## Step 3 — Create `deploy/ansible/demo_vars.example.yml`

**File to create:** `deploy/ansible/demo_vars.example.yml`

```yaml
# Llamenos Demo Instance Configuration
#
# Copy to demo_vars.yml and fill in your values.
# Encrypt with: ansible-vault encrypt demo_vars.yml

# ─── Domain & TLS ────────────────────────────────────────────────
domain: demo.llamenos-hotline.com
acme_email: admin@yourdomain.org

# ─── SSH Hardening ───────────────────────────────────────────────
ssh_port: 2222
ssh_allowed_cidrs:
  - "0.0.0.0/0"

# ─── Deploy User ─────────────────────────────────────────────────
deploy_user: deploy
deploy_group: deploy

# ─── Application ─────────────────────────────────────────────────
llamenos_image: ghcr.io/llamenos/llamenos:latest  # always latest for demo
caddy_image: caddy:2.9-alpine
postgres_image: postgres:17-alpine
minio_image: minio/minio:RELEASE.2025-01-20T14-49-07Z
app_dir: /opt/llamenos
hotline_name: "Hotline Demo"

# Must be "demo" to enable demo-mode reset endpoint
environment: demo

# Enables demo seeding in the app
demo_mode: "true"

# ─── Demo Reset ──────────────────────────────────────────────────
# Secret for /api/test-reset endpoint (requires X-Test-Secret header)
# Generate with: openssl rand -hex 32
# REQUIRED
dev_reset_secret: ""

# Cron schedule for auto-reset (host cron, UTC)
demo_reset_cron: "0 */4 * * *"  # every 4 hours

# ─── Admin Keypair ───────────────────────────────────────────────
# REQUIRED
admin_pubkey: ""
admin_decryption_pubkey: ""

# ─── Secrets ─────────────────────────────────────────────────────
# REQUIRED — generate with: just generate-secrets
hmac_secret: ""
pg_password: ""
minio_access_key: ""
minio_secret_key: ""
minio_bucket: llamenos-files
server_nostr_secret: ""

# ─── Telephony (optional for demo) ──────────────────────────────
twilio_account_sid: ""
twilio_auth_token: ""
twilio_phone_number: ""

# ─── Backup (minimal — no off-site required for demo) ───────────
backup_enabled: false
backup_age_public_key: ""
backup_rclone_remote: ""
```

---

## Step 4 — Update `llamenos` Ansible Role

**Files to check first:** `find deploy/ansible/roles/llamenos -name "*.j2"` — find the `env.j2` template.

**4a — Update `env.j2` template** to include demo vars:

Ensure these lines are present (add if missing):
```jinja2
ENVIRONMENT={{ environment | default('production') }}
DEMO_MODE={{ demo_mode | default('') }}
DEV_RESET_SECRET={{ dev_reset_secret | default('') }}
```

**4b — Add cron task to `roles/llamenos/tasks/main.yml`** (conditionally for demo):

```yaml
- name: Install demo data reset cron job
  ansible.builtin.cron:
    name: "Llamenos demo data reset"
    minute: "{{ demo_reset_cron.split(' ')[0] }}"
    hour: "{{ demo_reset_cron.split(' ')[1] }}"
    day: "{{ demo_reset_cron.split(' ')[2] }}"
    month: "{{ demo_reset_cron.split(' ')[3] }}"
    weekday: "{{ demo_reset_cron.split(' ')[4] }}"
    user: "{{ deploy_user }}"
    job: >-
      curl -sf -X POST https://{{ domain }}/api/test-reset
      -H "X-Test-Secret: {{ dev_reset_secret }}"
      >> /var/log/llamenos-demo-reset.log 2>&1
    state: present
  when: demo_mode | default('') | string == 'true'
```

---

## Step 5 — Create `deploy/ansible/playbooks/deploy-demo.yml`

**File to create:** `deploy/ansible/playbooks/deploy-demo.yml`

```yaml
---
# Demo Instance Deployment Playbook
#
# Usage: just deploy-demo
# Or: just deploy-demo -i inventory-demo.yml --ask-vault-pass

- name: Load demo configuration variables
  hosts: demo
  gather_facts: false
  tasks:
    - name: Include demo vars file
      ansible.builtin.include_vars:
        file: "{{ demo_vars_file | default('../demo_vars.yml') }}"
      tags: always

- import_playbook: preflight.yml

- name: Harden demo server
  ansible.builtin.import_playbook: harden.yml

- name: Deploy demo instance
  hosts: demo
  become: true
  roles:
    - role: docker
      tags: [docker, deploy]
    - role: llamenos
      tags: [llamenos, deploy]
```

---

## Step 6 — Create `deploy/ansible/playbooks/reset-demo.yml`

**File to create:** `deploy/ansible/playbooks/reset-demo.yml`

```yaml
---
# Demo Data Reset Playbook (on-demand)
#
# Usage: just reset-demo

- name: Reset demo data
  hosts: demo
  gather_facts: false
  vars_files:
    - "{{ demo_vars_file | default('../demo_vars.yml') }}"
  tasks:
    - name: Call demo reset endpoint
      ansible.builtin.uri:
        url: "https://{{ domain }}/api/test-reset"
        method: POST
        headers:
          X-Test-Secret: "{{ dev_reset_secret }}"
        status_code: 200
      register: reset_result

    - name: Display reset result
      ansible.builtin.debug:
        msg: "Demo data reset complete: {{ reset_result.json }}"
```

---

## Step 7 — Update `deploy/ansible/justfile`

Add after existing recipes:

```makefile
# Deploy or update the demo instance
deploy-demo *ARGS:
    ansible-playbook playbooks/deploy-demo.yml --ask-vault-pass {{ARGS}}

# Reset demo data on demand
reset-demo *ARGS:
    ansible-playbook playbooks/reset-demo.yml --ask-vault-pass {{ARGS}}

# Encrypt the demo vars file
encrypt-demo-vars:
    ansible-vault encrypt demo_vars.yml

# Edit encrypted demo vars file
edit-demo-vars:
    ansible-vault edit demo_vars.yml
```

---

## Step 8 — Update `package.json` Scripts

**File:** `package.json`

```json
// Before:
"deploy": "bun run deploy:demo && bun run deploy:site",
"deploy:demo": "bun run build && bunx wrangler deploy",

// After:
"deploy": "bun run deploy:site",
"deploy:cloudflare": "bun run build && bunx wrangler deploy",
```

---

## Step 9 — Update `wrangler.jsonc` Header Comment

Add at the top:
```jsonc
// CF Workers is the optional demo target. Primary deployment is Docker + Ansible.
// To deploy to CF Workers (manual only): bun run deploy:cloudflare
// For the primary VPS demo server: see deploy/ansible/justfile → deploy-demo
```

---

## Step 10 — Update `ci.yml` Header Comment

Lines 7–8: Change:
```
#   7. Deploy API to Cloudflare Workers + marketing site to Cloudflare Pages
```
To:
```
#   7. Deploy marketing site to Cloudflare Pages
#      (App deployment to VPS via Ansible — manual: see deploy/ansible/justfile)
```

No job changes needed — there is no active CF Workers deploy job in CI.

---

## Step 11 — Create `.github/workflows/deploy-demo.yml`

**File to create:** `.github/workflows/deploy-demo.yml`

```yaml
name: Deploy Demo

on:
  workflow_dispatch:
    inputs:
      reset_data:
        description: "Reset demo data after deploy?"
        type: boolean
        default: false

jobs:
  deploy-demo:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Install Ansible
        run: pip install ansible && ansible-galaxy collection install community.docker

      - name: Write inventory from secret
        run: printf '%s' "$DEMO_INVENTORY_YML" > deploy/ansible/inventory-demo.yml
        env:
          DEMO_INVENTORY_YML: ${{ secrets.DEMO_INVENTORY_YML }}

      - name: Write vault password file
        run: printf '%s' "$ANSIBLE_VAULT_PASSWORD" > /tmp/vault-pass
        env:
          ANSIBLE_VAULT_PASSWORD: ${{ secrets.ANSIBLE_VAULT_PASSWORD }}

      - name: Write encrypted demo vars
        run: printf '%s' "$DEMO_VARS_YML_ENCRYPTED" > deploy/ansible/demo_vars.yml
        env:
          DEMO_VARS_YML_ENCRYPTED: ${{ secrets.DEMO_VARS_YML_ENCRYPTED }}

      - name: Write SSH private key
        run: |
          mkdir -p ~/.ssh
          printf '%s\n' "$DEMO_SSH_PRIVATE_KEY" > ~/.ssh/llamenos_demo_deploy
          chmod 600 ~/.ssh/llamenos_demo_deploy
        env:
          DEMO_SSH_PRIVATE_KEY: ${{ secrets.DEMO_SSH_PRIVATE_KEY }}

      - name: Deploy demo
        working-directory: deploy/ansible
        run: |
          ansible-playbook playbooks/deploy-demo.yml \
            -i inventory-demo.yml \
            --vault-password-file /tmp/vault-pass

      - name: Reset demo data
        if: inputs.reset_data
        working-directory: deploy/ansible
        run: |
          ansible-playbook playbooks/reset-demo.yml \
            -i inventory-demo.yml \
            --vault-password-file /tmp/vault-pass

      - name: Clean up secrets
        if: always()
        run: |
          rm -f /tmp/vault-pass
          rm -f ~/.ssh/llamenos_demo_deploy
          rm -f deploy/ansible/inventory-demo.yml
          rm -f deploy/ansible/demo_vars.yml
```

### Required GitHub Secrets

| Secret | Description | How to generate |
|---|---|---|
| `DEMO_INVENTORY_YML` | Full YAML content of demo inventory file | Copy `inventory.example.yml`, fill in demo VPS IP |
| `ANSIBLE_VAULT_PASSWORD` | Vault passphrase | Strong random passphrase |
| `DEMO_VARS_YML_ENCRYPTED` | `ansible-vault encrypt --output - demo_vars.yml` output | Run after filling demo_vars.yml |
| `DEMO_SSH_PRIVATE_KEY` | PEM private key for demo VPS deploy user | `ssh-keygen -t ed25519 -f ~/.ssh/llamenos_demo_deploy` |

---

## Step 12 — Update `CLAUDE.md`

- Change `deploy:demo` reference → `deploy:cloudflare`
- Update deployment rules paragraph to reflect Ansible as primary
- Update `bun run deploy` description (site only now)

---

## Verification Checklist

1. `bun run typecheck` — no errors from `dev.ts` guard change
2. `bun run build` — succeeds
3. Local: start Docker with `ENVIRONMENT=demo`, confirm `POST /api/test-reset` with `X-Test-Secret` → `{"ok":true}`
4. Local: confirm `POST /api/test-reset` without header → `403`
5. `cd deploy/ansible && ansible-lint playbooks/deploy-demo.yml playbooks/reset-demo.yml` — clean
6. `just --list` — shows `deploy-demo`, `reset-demo`, `encrypt-demo-vars`, `edit-demo-vars`
7. `bun run deploy` — only triggers `bun run deploy:site` (not CF)
8. `bun run deploy:cloudflare` — still works (manual CF option)

---

## Files Created / Modified

| File | Action |
|------|--------|
| `src/worker/routes/dev.ts` | Modify (add `'demo'` to environment guard) |
| `deploy/ansible/inventory.example.yml` | Modify (add demo group + ansible_connection: local) |
| `deploy/ansible/demo_vars.example.yml` | Create |
| `deploy/ansible/roles/llamenos/templates/env.j2` | Modify (add DEMO_MODE, DEV_RESET_SECRET, ENVIRONMENT) |
| `deploy/ansible/roles/llamenos/tasks/main.yml` | Modify (add demo cron task) |
| `deploy/ansible/playbooks/deploy-demo.yml` | Create |
| `deploy/ansible/playbooks/reset-demo.yml` | Create |
| `deploy/ansible/justfile` | Modify (add 4 recipes) |
| `package.json` | Modify (rename deploy:demo → deploy:cloudflare, update deploy) |
| `wrangler.jsonc` | Modify (add header comment) |
| `.github/workflows/ci.yml` | Modify (stale comment update only) |
| `.github/workflows/deploy-demo.yml` | Create |
| `CLAUDE.md` | Modify |
