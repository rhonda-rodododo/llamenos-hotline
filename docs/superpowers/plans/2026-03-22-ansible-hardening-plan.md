# Ansible Hardening — Implementation Plan

**Date:** 2026-03-22
**Spec:** docs/superpowers/specs/2026-03-22-ansible-hardening-design.md
**Status:** Ready to implement

---

## Dependency Order

```
PARALLEL (no dependencies):
  Step 1: Create .ansible-lint
  Step 2: Create playbooks/preflight.yml
  Step 3: Rewrite vars.example.yml
  Step 4: Rewrite update.yml rollback logic

SEQUENTIAL (after Step 2):
  Step 5: Add preflight import to setup.yml
  Step 6: Add preflight import to harden.yml
  Step 7: Add preflight import to deploy.yml

SEQUENTIAL (after Steps 1–7):
  Step 8: Add justfile recipes (validate, dry-run)
  Step 9: Add CI job and changes output (after Steps 1–8)
```

---

## Step 1 — Create `deploy/ansible/.ansible-lint`

**File to create:** `deploy/ansible/.ansible-lint`

```yaml
---
profile: production
warn_list:
  - yaml[line-length]
  - name[casing]
skip_list: []
```

Notes:
- `profile: production` enforces the strictest built-in ruleset
- `yaml[line-length]` is warned (not failed) — Ansible task `msg:` blocks often need long lines
- Co-located with ansible files so `cd deploy/ansible && ansible-lint .` picks it up automatically

---

## Step 2 — Create `deploy/ansible/playbooks/preflight.yml`

**File to create:** `deploy/ansible/playbooks/preflight.yml`

```yaml
---
# Preflight Checks
#
# Validates all required variables are set and not placeholder values.
# Import this at the top of every playbook that modifies the server.

- name: Preflight checks
  hosts: all
  gather_facts: false
  tasks:
    - name: Validate required variables
      ansible.builtin.assert:
        that:
          - domain is defined
          - domain | length > 0
          - domain != 'hotline.yourdomain.org'
          - acme_email is defined
          - acme_email | length > 0
          - acme_email != 'admin@yourdomain.org'
          - deploy_user is defined
          - deploy_user | length > 0
          - llamenos_image is defined
          - llamenos_image | length > 0
          - admin_pubkey is defined
          - admin_pubkey | length == 64
          - admin_decryption_pubkey is defined
          - admin_decryption_pubkey | length == 64
          - hmac_secret is defined
          - hmac_secret | length >= 32
          - server_nostr_secret is defined
          - server_nostr_secret | length == 64
          - pg_password is defined
          - pg_password | length >= 16
          - minio_access_key is defined
          - minio_access_key | length > 0
          - minio_secret_key is defined
          - minio_secret_key | length >= 16
        fail_msg: |
          Pre-flight check failed. One or more required variables are missing,
          empty, or still set to placeholder values. Please review:

            deploy/ansible/vars.example.yml

          Copy it to vars.yml and fill in all REQUIRED fields.
          Generate secrets with: just generate-secrets
          Then encrypt: just encrypt-vars

    - name: Warn if SSH is open to all IPs
      ansible.builtin.debug:
        msg: >-
          WARNING: ssh_allowed_cidrs includes 0.0.0.0/0.
          Restrict to your admin IP/32 before production.
      when: >-
        ssh_allowed_cidrs is defined and
        '0.0.0.0/0' in ssh_allowed_cidrs
```

---

## Step 3 — Rewrite `deploy/ansible/vars.example.yml`

**File to modify:** `deploy/ansible/vars.example.yml`

All required secrets need valid-length placeholder values so the CI dry-run passes the preflight assertions (the preflight checks length, not whether values are "real").

**Key additions:**

1. Add `admin_decryption_pubkey` (missing entirely — required by preflight):
```yaml
# Admin decryption public key (for E2EE note access)
# Generate with: bun run bootstrap-admin
# REQUIRED
admin_decryption_pubkey: "0000000000000000000000000000000000000000000000000000000000000000"  # PLACEHOLDER
```

2. Change all empty secret values (`""`) to valid-length placeholders:
```yaml
admin_pubkey: "0000000000000000000000000000000000000000000000000000000000000000"  # PLACEHOLDER — 64 hex chars
admin_decryption_pubkey: "0000000000000000000000000000000000000000000000000000000000000000"  # PLACEHOLDER — 64 hex chars
hmac_secret: "00000000000000000000000000000000000000000000000000000000000000000000"  # PLACEHOLDER — min 32 chars
pg_password: "PLACEHOLDER-replace-this-pg-password"  # PLACEHOLDER — min 16 chars
minio_access_key: "PLACEHOLDER-minio-access"  # PLACEHOLDER
minio_secret_key: "PLACEHOLDER-minio-secret-key-16ch"  # PLACEHOLDER — min 16 chars
server_nostr_secret: "0000000000000000000000000000000000000000000000000000000000000000"  # PLACEHOLDER — 64 hex chars
```

3. Add generation instructions block near the top:
```yaml
# ─── Quick Start ─────────────────────────────────────────────
# 1. cp vars.example.yml vars.yml
# 2. Edit vars.yml — replace all PLACEHOLDER values with real ones
# 3. Generate secrets: just generate-secrets
# 4. Encrypt: just encrypt-vars
```

4. Mark all vars as `# REQUIRED` or `# OPTIONAL`.

5. Add `ansible_connection: local` to `inventory.example.yml` for CI dry-run safety:
```yaml
all:
  hosts:
    llamenos:
      ansible_host: 203.0.113.10
      ansible_user: deploy
      ansible_port: 22
      ansible_connection: local  # CI dry-run only — real inventory uses SSH
```

---

## Step 4 — Rewrite Rollback Logic in `deploy/ansible/playbooks/update.yml`

**File to modify:** `deploy/ansible/playbooks/update.yml`

The current rollback task is a no-op stub. Replace the entire task block with proper digest-based rollback using a compose override file.

**Before pulling new images, add:**

```yaml
    - name: Save current image digest for rollback
      ansible.builtin.shell: >-
        docker inspect --format='{{ '{{' }}.Image{{ '}}' }}'
        $(docker compose -f {{ app_dir }}/docker-compose.yml ps -q app 2>/dev/null | head -1)
        2>/dev/null || echo ""
      register: current_image_digest
      changed_when: false

    - name: Write rollback digest file
      ansible.builtin.copy:
        content: "{{ current_image_digest.stdout | trim }}"
        dest: "{{ app_dir }}/.rollback-image"
        owner: "{{ deploy_user }}"
        group: "{{ deploy_group }}"
        mode: "0600"
      when: current_image_digest.stdout | trim | length > 0
```

**After restart, replace health check and rollback stub with:**

```yaml
    - name: Wait for application health check
      ansible.builtin.uri:
        url: "https://{{ domain }}/api/health/ready"
        method: GET
        status_code: 200
      register: health_check
      retries: 12
      delay: 5
      until: health_check.status == 200
      ignore_errors: true

    - name: Rollback on health check failure
      when: health_check is failed or health_check.status != 200
      block:
        - name: Log rollback initiation
          ansible.builtin.debug:
            msg: "Health check failed — initiating rollback to previous image."

        - name: Read rollback image digest
          ansible.builtin.slurp:
            src: "{{ app_dir }}/.rollback-image"
          register: rollback_digest

        - name: Write docker-compose rollback override
          ansible.builtin.copy:
            content: |
              services:
                app:
                  image: {{ rollback_digest.content | b64decode | trim }}
            dest: "{{ app_dir }}/docker-compose.rollback.yml"
            owner: "{{ deploy_user }}"
            group: "{{ deploy_group }}"
            mode: "0640"

        - name: Restart with rollback image
          community.docker.docker_compose_v2:
            project_src: "{{ app_dir }}"
            files:
              - docker-compose.yml
              - docker-compose.rollback.yml
            state: present
            recreate: always

        - name: Verify rollback health
          ansible.builtin.uri:
            url: "https://{{ domain }}/api/health/ready"
            method: GET
            status_code: 200
          register: rollback_health
          retries: 6
          delay: 5
          until: rollback_health.status == 200

        - name: Clean up rollback override
          ansible.builtin.file:
            path: "{{ app_dir }}/docker-compose.rollback.yml"
            state: absent

        - name: Fail with rollback notice
          ansible.builtin.fail:
            msg: |
              Update failed — rolled back to previous image.
              Image: {{ rollback_digest.content | b64decode | trim }}
              Logs: docker compose -f {{ app_dir }}/docker-compose.yml logs app
```

**Note on Jinja2 escaping:** `docker inspect --format` uses `{{ }}` which conflicts with Ansible templating. Escape as `{{ '{{' }}.Image{{ '}}' }}` in the actual YAML.

---

## Step 5 — Add Preflight Import to `deploy/ansible/setup.yml`

**File to modify:** `deploy/ansible/setup.yml`

Insert `- import_playbook: playbooks/preflight.yml` after the vars-loading play and before harden:

```yaml
- name: Load configuration variables
  hosts: all
  gather_facts: false
  tasks:
    - name: Include vars file
      ansible.builtin.include_vars:
        file: vars.yml
      tags: always

- import_playbook: playbooks/preflight.yml   # ADD

- import_playbook: playbooks/harden.yml
- import_playbook: playbooks/deploy.yml
```

---

## Step 6 — Add Preflight Import to `deploy/ansible/playbooks/harden.yml`

**File to modify:** `deploy/ansible/playbooks/harden.yml`

Add a vars-loading play before the preflight import (so preflight works when run standalone via `just harden`). Remove `vars_files` from the harden play (vars already loaded):

```yaml
---
- name: Load configuration variables
  hosts: all
  gather_facts: false
  tasks:
    - name: Include vars file
      ansible.builtin.include_vars:
        file: ../vars.yml
      tags: always

- import_playbook: preflight.yml

- name: Harden server
  hosts: all
  become: true
  # Remove vars_files from here — already loaded above
  roles:
    - role: common
      tags: [common, harden]
    - role: ssh-hardening
      tags: [ssh, harden]
    - role: firewall
      tags: [firewall, harden]
    - role: kernel-hardening
      tags: [kernel, harden]
    - role: fail2ban
      tags: [fail2ban, harden]
    - role: docker
      tags: [docker, harden]
```

---

## Step 7 — Add Preflight Import to `deploy/ansible/playbooks/deploy.yml`

Same pattern as Step 6:

```yaml
---
- name: Load configuration variables
  hosts: all
  gather_facts: false
  tasks:
    - name: Include vars file
      ansible.builtin.include_vars:
        file: ../vars.yml
      tags: always

- import_playbook: preflight.yml

- name: Deploy Llamenos
  hosts: all
  become: true
  # Remove vars_files — already loaded above
  roles:
    - role: docker
      tags: [docker, deploy]
    - role: llamenos
      tags: [llamenos, deploy]
```

---

## Step 8 — Add `validate` and `dry-run` Recipes to Justfile

**File to modify:** `deploy/ansible/justfile`

Add after existing recipes:

```makefile
# Validate playbooks without making changes (CI-safe, uses example inventory and vars)
validate *ARGS:
    ansible-lint .
    ansible-playbook setup.yml --check --diff \
        -i inventory.example.yml \
        --extra-vars "@vars.example.yml" \
        {{ARGS}}

# Show what would change on the server (requires vault password)
dry-run *ARGS:
    ansible-playbook setup.yml --check --diff --ask-vault-pass {{ARGS}}
```

---

## Step 9 — Add `ansible-validate` Job to `ci.yml`

**File to modify:** `.github/workflows/ci.yml`

### 9a — Add `ansible` output to `changes` job

In the changes detection script, before the `} >> "$GITHUB_OUTPUT"` block, add:

```bash
# Detect ansible changes
ANSIBLE_CHANGED="false"
if echo "$CHANGED" | grep -qE "^deploy/ansible/"; then
  ANSIBLE_CHANGED="true"
fi
```

Add to the outputs section:
```bash
echo "ansible=$ANSIBLE_CHANGED" >> "$GITHUB_OUTPUT"
```

Add to `changes` job `outputs:`:
```yaml
ansible: ${{ steps.filter.outputs.ansible }}
```

### 9b — Add `ansible-validate` job

Add after the `audit` job:

```yaml
  # ─── Ansible Validation ────────────────────────────────────
  ansible-validate:
    needs: changes
    if: needs.changes.outputs.ansible == 'true' || needs.changes.outputs.app == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Install Ansible and ansible-lint
        run: pip install ansible ansible-lint

      - name: Install required collections
        run: ansible-galaxy collection install community.docker

      - name: Run ansible-lint
        run: cd deploy/ansible && ansible-lint .

      - name: Dry-run check
        run: |
          cd deploy/ansible
          ansible-playbook setup.yml --check --diff \
            -i inventory.example.yml \
            --extra-vars "@vars.example.yml"
```

---

## Verification

```bash
# Local
cd deploy/ansible
pip install ansible ansible-lint
ansible-galaxy collection install community.docker
ansible-lint .                          # must pass
just validate                           # must pass (dry-run against example files)

# Verify preflight blocks placeholder domain
ansible-playbook playbooks/preflight.yml \
  -i inventory.example.yml \
  --extra-vars "domain='' acme_email=''"
# ^ must fail with "Pre-flight check failed"

# Verify preflight passes with valid-length placeholders
ansible-playbook setup.yml --check --diff \
  -i inventory.example.yml \
  --extra-vars "@vars.example.yml"
# ^ must succeed past preflight
```

After CI push: `ansible-validate` job appears in Actions, runs green, and is skipped on docs-only changes.

---

## Files Created / Modified

| File | Action |
|------|--------|
| `deploy/ansible/.ansible-lint` | Create |
| `deploy/ansible/playbooks/preflight.yml` | Create |
| `deploy/ansible/vars.example.yml` | Modify |
| `deploy/ansible/inventory.example.yml` | Modify (add `ansible_connection: local`) |
| `deploy/ansible/playbooks/update.yml` | Modify (rewrite rollback) |
| `deploy/ansible/setup.yml` | Modify (add preflight import) |
| `deploy/ansible/playbooks/harden.yml` | Modify (add vars play + preflight) |
| `deploy/ansible/playbooks/deploy.yml` | Modify (add vars play + preflight) |
| `deploy/ansible/justfile` | Modify (add validate, dry-run) |
| `.github/workflows/ci.yml` | Modify (ansible output + new job) |
