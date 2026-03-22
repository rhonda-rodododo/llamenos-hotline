# Ansible Hardening — Design Spec

**Date:** 2026-03-22
**Status:** Approved

## Overview

Harden the v1 Ansible deployment pipeline for production-grade reliability: CI-based dry-run validation, required-vars preflight guards, improved rollback on failed updates, and ansible-lint enforcement. The goal is that operators can run `just setup-all` with confidence that it will either succeed cleanly or fail loudly with actionable errors.

---

## 1. CI Dry-Run Validation

### What

Add a GitHub Actions job that validates all Ansible playbooks against a mock inventory using `--check --diff` (dry-run mode). This catches YAML syntax errors, undefined variable references, role logic regressions, and missing module imports without requiring a real server.

### Implementation

Add job `ansible-validate` to `.github/workflows/ci.yml`. Also add an `ansible` output to the `changes` job (alongside the existing `app`, `site`, `docs_only` outputs):

```bash
# In the changes job filter script, add:
ANSIBLE_CHANGED="false"
if echo "$CHANGED" | grep -qE "^deploy/ansible/"; then
  ANSIBLE_CHANGED="true"
fi
echo "ansible=$ANSIBLE_CHANGED" >> "$GITHUB_OUTPUT"
```

```yaml
ansible-validate:
  needs: changes
  if: needs.changes.outputs.ansible == 'true' || needs.changes.outputs.app == 'true'
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    - name: Install Ansible
      run: pip install ansible ansible-lint
    - name: Install collections
      run: ansible-galaxy collection install community.docker
    - name: Lint
      run: cd deploy/ansible && ansible-lint .
    - name: Dry-run check
      run: |
        cd deploy/ansible
        ansible-playbook setup.yml --check --diff \
          -i inventory.example.yml \
          --extra-vars "@vars.example.yml"
```

The `vars.example.yml` must contain non-empty, non-placeholder values for all required vars so the dry-run doesn't fail on variable errors (actual validation is the preflight guard's job).

### ansible-lint

Add `ansible-lint` to the validate job:
```bash
pip install ansible-lint
ansible-lint deploy/ansible/
```

Add `deploy/ansible/.ansible-lint` config (co-located with ansible files, not repo root) to configure rule profile and exclude any intentional exceptions.

---

## 2. Required-Vars Preflight Guard

### What

A `preflight.yml` pre-tasks file included at the top of `setup.yml` and each individual playbook. It validates that all required variables are set and not placeholder values before any changes are made to the server.

### Required vars to check

```
domain                — not empty, not "hotline.yourdomain.org"
acme_email            — not empty, not "admin@yourdomain.org"
ssh_allowed_cidrs     — must not be ["0.0.0.0/0"] alone (warn, not fail)
deploy_user           — not empty
llamenos_image        — not empty
admin_pubkey          — not empty, exactly 64 hex chars
admin_decryption_pubkey — not empty, exactly 64 hex chars
hmac_secret           — not empty, at least 32 chars
server_nostr_secret   — not empty, exactly 64 hex chars
pg_password           — not empty, at least 16 chars
minio_access_key      — not empty
minio_secret_key      — not empty, at least 16 chars
```

### Implementation

`deploy/ansible/playbooks/preflight.yml`:
```yaml
- name: Preflight checks
  hosts: all
  gather_facts: false
  tasks:
    - name: Check required variables
      ansible.builtin.assert:
        that:
          - domain is defined and domain != '' and domain != 'hotline.yourdomain.org'
          - acme_email is defined and acme_email != '' and acme_email != 'admin@yourdomain.org'
          - admin_pubkey is defined and admin_pubkey | length == 64
          - hmac_secret is defined and hmac_secret | length >= 32
          - server_nostr_secret is defined and server_nostr_secret | length == 64
          - pg_password is defined and pg_password | length >= 16
          - minio_secret_key is defined and minio_secret_key | length >= 16
        fail_msg: |
          Pre-flight check failed. Please review deploy/ansible/vars.example.yml
          and ensure all required variables are set with non-placeholder values.

    - name: Warn if SSH is open to all IPs
      ansible.builtin.debug:
        msg: "WARNING: ssh_allowed_cidrs includes 0.0.0.0/0 — restrict to your admin IP for production"
      when: "'0.0.0.0/0' in ssh_allowed_cidrs"
```

Include in all playbooks:
```yaml
- import_playbook: preflight.yml
```

---

## 3. Rollback on Failed Update

### What

The `update.yml` playbook currently pulls new images and restarts the stack. If the health check fails, the stack is left in a broken state. Add automatic rollback to the previous image tag.

### Implementation

In `playbooks/update.yml`, before pulling:
1. Read the current image digest from `docker inspect` and save to a rollback file on the host (`/opt/llamenos/.rollback-image`)
2. Pull and restart
3. Run health check (with retries)
4. If health check fails within 60s, run rollback: set image back to saved digest, restart stack, verify health recovers
5. If rollback also fails, emit an explicit failure message with recovery instructions

```yaml
- name: Save current image digest for rollback
  ansible.builtin.shell: >
    docker inspect --format='{{ "{{" }}.Image{{ "}}" }}' $(docker compose -f {{ app_dir }}/docker-compose.yml ps -q app)
  register: current_image_digest
  changed_when: false

- name: Write rollback file
  ansible.builtin.copy:
    content: "{{ current_image_digest.stdout }}"
    dest: "{{ app_dir }}/.rollback-image"
    mode: "0600"
```

After restart, health check:
```yaml
- name: Health check post-update
  ansible.builtin.uri:
    url: "https://{{ domain }}/api/health/ready"
    status_code: 200
  register: health
  retries: 12
  delay: 5
  until: health.status == 200
  ignore_errors: true

- name: Rollback if health check failed
  when: health.failed
  block:
    - name: Read rollback image digest
      ansible.builtin.slurp:
        src: "{{ app_dir }}/.rollback-image"
      register: rollback_digest

    - name: Pin compose to rollback image via override
      ansible.builtin.copy:
        content: |
          services:
            app:
              image: {{ rollback_digest.content | b64decode | trim }}
        dest: "{{ app_dir }}/docker-compose.rollback.yml"
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
        status_code: 200
      register: rollback_health
      retries: 6
      delay: 5
      until: rollback_health.status == 200

    - name: Fail with rollback notice
      ansible.builtin.fail:
        msg: |
          Update failed — rolled back to previous image.
          Rollback image: {{ rollback_digest.content | b64decode | trim }}
          Check logs: docker compose -f {{ app_dir }}/docker-compose.yml logs app

    - name: Clean up rollback override
      ansible.builtin.file:
        path: "{{ app_dir }}/docker-compose.rollback.yml"
        state: absent
```

---

## 4. `vars.example.yml` Improvements

Update `vars.example.yml` to:
- Add all required vars that are currently missing (e.g., `admin_decryption_pubkey`, `hmac_secret`, `server_nostr_secret`, `minio_access_key`, `minio_secret_key`, `pg_password`)
- Mark each as `# REQUIRED` or `# OPTIONAL` with clear comments
- Add generation instructions (e.g., `openssl rand -hex 32` for secrets)
- Add `# PLACEHOLDER — replace before use` to placeholder values so the preflight regex can detect them

---

## 5. justfile Additions

Add to `deploy/ansible/justfile`:

```makefile
# Validate playbooks without making changes (CI-safe)
validate *ARGS:
    ansible-lint .
    ansible-playbook setup.yml --check --diff -i inventory.example.yml --extra-vars "@vars.example.yml" {{ARGS}}

# Show what would change on the server (no vault needed if using plaintext example)
dry-run *ARGS:
    ansible-playbook setup.yml --check --diff --ask-vault-pass {{ARGS}}
```

---

## Testing

- `just validate` passes in CI with no real server
- `just setup-all` fails fast with clear error if placeholder values remain in `vars.yml`
- `just update` with a broken image triggers automatic rollback and reports failure
- `ansible-lint` passes with zero errors

## Out of Scope

- Ansible molecule for full role unit testing (future)
- Multi-server inventory support
- Automated VPS provisioning (that's the OpenTofu workstream)
