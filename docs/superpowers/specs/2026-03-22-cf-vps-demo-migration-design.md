# CF → VPS Demo Migration — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Migrate the v1 demo deployment from Cloudflare Workers to a VPS running Docker Compose via Ansible. The demo becomes a proper self-hosted instance with `DEMO_MODE=true`, identical to what operators deploy in production. CF Workers remains available as an optional manual target but is removed from the primary CI/CD flow.

---

## 1. Current State

- `bun run deploy:demo` → `bun run build && bunx wrangler deploy` → CF Workers
- CI (`ci.yml`) runs `deploy` job that deploys to CF Workers on every push to main
- The CF demo URL is the only live demo for prospective operators
- `wrangler.jsonc` holds CF-specific Worker config

## 2. Target State

- Demo is a VPS (e.g., Hetzner CX22 or similar) running `docker compose up` with `DEMO_MODE=true`
- Deployed via Ansible: `just deploy-demo` in `deploy/ansible/justfile`
- A `[demo]` inventory group in `inventory.example.yml` with a `demo_mode: true` variable
- CI removes mandatory CF deploy job; adds optional manual-dispatch `deploy-demo` workflow
- `bun run deploy:cloudflare` replaces `deploy:demo` for anyone who still wants CF (opt-in, manual only)
- `wrangler.jsonc` is kept for the CF demo option but clearly labeled as optional/legacy

---

## 3. Ansible Demo Inventory

Add a `[demo]` group to `inventory.example.yml`:

```yaml
all:
  children:
    production:
      hosts:
        your-vps:
          ansible_host: 1.2.3.4
          ansible_user: deploy
          ansible_port: 2222
    demo:
      hosts:
        demo-vps:
          ansible_host: 5.6.7.8
          ansible_user: deploy
          ansible_port: 2222
```

Add `demo_vars.example.yml` (or a `demo:` section in `vars.example.yml`) with:
```yaml
demo_mode: true
hotline_name: "Hotline Demo"
llamenos_image: ghcr.io/llamenos/llamenos:latest  # always latest for demo
environment: demo  # distinct from "production" to avoid misconfiguration
demo_reset_interval: "0 */4 * * *"  # cron: reset demo data every 4 hours (matches prior CF behavior)
dev_reset_secret: "..."  # REQUIRED — used by reset-demo.yml playbook
```

The `llamenos` role templates `DEMO_MODE={{ demo_mode | default('') }}` into the `.env` file. No new role needed.

---

## 4. Ansible Demo Playbook

Add `playbooks/deploy-demo.yml`:

```yaml
---
- import_playbook: preflight.yml

- name: Deploy demo instance
  hosts: demo
  roles:
    - role: docker
    - role: llamenos
  vars:
    demo_mode: true
    hotline_name: "Hotline Demo"
```

Add to `justfile`:
```makefile
# Deploy or update the demo instance
deploy-demo *ARGS:
    ansible-playbook playbooks/deploy-demo.yml --ask-vault-pass {{ARGS}}

# Reset demo data (calls the DEV_RESET_SECRET endpoint)
reset-demo *ARGS:
    ansible-playbook playbooks/reset-demo.yml --ask-vault-pass {{ARGS}}
```

---

## 5. Demo Data Reset

The demo instance needs periodic data reset so it stays usable. Add `playbooks/reset-demo.yml`:

```yaml
- name: Reset demo data
  hosts: demo
  tasks:
    - name: Call reset endpoint
      ansible.builtin.uri:
        url: "https://{{ domain }}/api/dev/reset"
        method: POST
        headers:
          X-Dev-Reset-Secret: "{{ dev_reset_secret }}"
        status_code: 200
```

Add `dev_reset_secret` to required demo vars. The existing `DEV_RESET_SECRET` env var in the app already gates this endpoint.

---

## 6. CI Changes

### Remove mandatory CF deploy

Inspection of the current `ci.yml` shows **no active wrangler deploy job** — the header comment mentions CF Workers deployment but the actual job does not exist. The only action needed is: update the stale header comment to reflect that CF Workers is an optional manual target, not a CI artifact.

Required secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` can remain as repo secrets for manual use. No CI job changes are required beyond comment cleanup.

### Add manual deploy-demo workflow

Add `.github/workflows/deploy-demo.yml`:
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
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683

      - name: Install Ansible
        run: pip install ansible && ansible-galaxy collection install community.docker

      - name: Write inventory from secret
        run: echo "${{ secrets.DEMO_INVENTORY_YML }}" > deploy/ansible/inventory.yml
        # DEMO_INVENTORY_YML secret contains the full inventory.yml content

      - name: Write vault password file
        run: echo "${{ secrets.ANSIBLE_VAULT_PASSWORD }}" > /tmp/vault-pass
        # ANSIBLE_VAULT_PASSWORD secret holds the vault encryption passphrase

      - name: Write encrypted vars
        run: echo "${{ secrets.DEMO_VARS_YML_ENCRYPTED }}" > deploy/ansible/vars.yml
        # DEMO_VARS_YML_ENCRYPTED is the ansible-vault encrypted vars.yml content

      - name: Deploy demo
        run: cd deploy/ansible && ansible-playbook playbooks/deploy-demo.yml --vault-password-file /tmp/vault-pass

      - name: Reset demo data
        if: inputs.reset_data
        run: cd deploy/ansible && ansible-playbook playbooks/reset-demo.yml --vault-password-file /tmp/vault-pass

      - name: Clean up vault password
        if: always()
        run: rm -f /tmp/vault-pass
```

---

## 7. `package.json` Script Rename

```json
"deploy:cloudflare": "bun run build && bunx wrangler deploy",
"deploy:demo": "<removed or aliased to deploy:cloudflare with a deprecation note>"
```

Remove `deploy:demo` from the "Deployment rules" section of CLAUDE.md (handled by the Foundation Tooling workstream).

---

## 8. `wrangler.jsonc`

Keep as-is. Add a comment at the top:
```
// CF Workers is the optional demo target. Primary deployment is Docker + Ansible.
// To deploy to CF: bun run deploy:cloudflare
// For the primary demo server: see deploy/ansible/justfile -> deploy-demo
```

---

## Testing

- `just deploy-demo` against the demo inventory succeeds and health check passes
- `just reset-demo` resets demo data without error
- CI passes without `CLOUDFLARE_API_TOKEN` being a required secret for the main `ci.yml` jobs
- `bun run deploy:cloudflare` still works for manual CF deploys

## Out of Scope

- OpenTofu VPS provisioning (separate workstream)
- Removing Wrangler/CF from the repo entirely
- Marketing site changes (site/ deploys to CF Pages separately and remains unchanged)
