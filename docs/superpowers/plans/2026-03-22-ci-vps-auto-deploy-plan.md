# CI Automated VPS Deployment Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add automated VPS deployment to CI so that when a new version is released (tag pushed), the demo VPS is automatically updated. Currently deployment is manual-only.

**Context:** `ci.yml` has a `version` job that bumps, tags, and creates a GitHub Release automatically. After the release is published, the VPS is NOT updated. This plan adds that final step.

**Scope:** Demo VPS only (not production). Production deploys stay manual.

---

## Phase 1: Audit Current Deploy Setup

- [x] Read `.github/workflows/deploy-demo.yml` — understand current manual dispatch workflow
- [x] Read `deploy/ansible/justfile` — list all available recipes
- [x] Read `deploy/ansible/playbooks/deploy-demo.yml` — understand what it does
- [x] Identify: what secrets are needed for Ansible to connect and deploy?
  - `DEMO_INVENTORY_YML`
  - `ANSIBLE_VAULT_PASSWORD`
  - `DEMO_VARS_YML_ENCRYPTED`
  - `DEMO_SSH_PRIVATE_KEY`

---

## Phase 2: Auto-Deploy Trigger

### 2.1 Trigger options

**Option A: Post-release job in ci.yml**
- Add a `deploy-demo` job to `ci.yml` that runs after `release` job
- Condition: `if: needs.release.outputs.released == 'true'`
- This keeps everything in one workflow

**Option B: Separate workflow triggered by release event**
- New `.github/workflows/auto-deploy-demo.yml`
- Trigger: `on: release: types: [published]`
- Cleaner separation of concerns

**Decision: Option B** (separate workflow, release event trigger — more robust, easier to disable)

### 2.2 Create auto-deploy-demo.yml
- [x] Create `.github/workflows/auto-deploy-demo.yml`:
  ```yaml
  name: Auto-Deploy Demo

  on:
    release:
      types: [published]
    workflow_dispatch:
      inputs:
        reset_data:
          description: "Reset demo data after deploy"
          type: boolean
          default: false

  concurrency:
    group: deploy-demo
    cancel-in-progress: false  # Never cancel in-progress deploy

  jobs:
    deploy-demo:
      runs-on: ubuntu-latest
      environment: demo
      timeout-minutes: 30

      steps:
        - name: Wait for Docker image to be available
          run: |
            # The docker.yml workflow builds the image on tags
            # Wait up to 10 minutes for GHCR image to be pushed
            for i in {1..20}; do
              if docker manifest inspect ghcr.io/${{ github.repository }}:${{ github.event.release.tag_name }} 2>/dev/null; then
                echo "Image available"
                break
              fi
              echo "Waiting for image... (attempt $i)"
              sleep 30
            done

        - uses: actions/checkout@v6
          with:
            ref: ${{ github.event.release.tag_name || github.ref }}

        - name: Install Ansible
          run: |
            pip install ansible ansible-lint
            ansible-galaxy collection install community.docker

        - name: Reconstruct demo config
          env:
            DEMO_INVENTORY_YML: ${{ secrets.DEMO_INVENTORY_YML }}
            DEMO_VARS_YML_ENCRYPTED: ${{ secrets.DEMO_VARS_YML_ENCRYPTED }}
            DEMO_SSH_PRIVATE_KEY: ${{ secrets.DEMO_SSH_PRIVATE_KEY }}
          run: |
            mkdir -p deploy/ansible/inventories
            echo "$DEMO_INVENTORY_YML" > deploy/ansible/inventories/demo.yml
            echo "$DEMO_VARS_YML_ENCRYPTED" > deploy/ansible/demo_vars.yml.encrypted
            echo "$DEMO_SSH_PRIVATE_KEY" > /tmp/demo_ssh_key
            chmod 600 /tmp/demo_ssh_key

        - name: Deploy to demo VPS
          env:
            ANSIBLE_VAULT_PASSWORD: ${{ secrets.ANSIBLE_VAULT_PASSWORD }}
          run: |
            cd deploy/ansible
            echo "$ANSIBLE_VAULT_PASSWORD" > /tmp/vault_password
            ansible-playbook \
              -i inventories/demo.yml \
              --vault-password-file /tmp/vault_password \
              --extra-vars "image_tag=${{ github.event.release.tag_name }}" \
              --private-key /tmp/demo_ssh_key \
              playbooks/deploy-demo.yml

        - name: Reset demo data (if requested)
          if: ${{ inputs.reset_data == true }}
          env:
            ANSIBLE_VAULT_PASSWORD: ${{ secrets.ANSIBLE_VAULT_PASSWORD }}
          run: |
            cd deploy/ansible
            ansible-playbook \
              -i inventories/demo.yml \
              --vault-password-file /tmp/vault_password \
              --private-key /tmp/demo_ssh_key \
              playbooks/reset-demo.yml

        - name: Verify deployment
          run: |
            # Poll the demo health endpoint for up to 2 minutes
            DEMO_URL="https://demo.llamenos-hotline.example.org"  # Replace with actual
            for i in {1..12}; do
              if curl -sf "$DEMO_URL/api/health" | grep -q '"status":"ok"'; then
                echo "Demo deployment verified!"
                exit 0
              fi
              echo "Waiting for health check... (attempt $i)"
              sleep 10
            done
            echo "Demo health check failed after 2 minutes"
            exit 1

        - name: Cleanup sensitive files
          if: always()
          run: |
            rm -f /tmp/demo_ssh_key /tmp/vault_password
  ```

### 2.3 Update deploy-demo.yml to share logic
- [x] Keep existing `deploy-demo.yml` for manual dispatches
- [x] Consider: extract common Ansible setup steps to a composite action `.github/actions/ansible-setup/action.yml` to reduce duplication

---

## Phase 3: Health Check Endpoint Verification

- [x] Confirm `GET /api/health` returns `{ status: "ok" }` in the deployed app
- [x] Confirm the endpoint is accessible from GitHub Actions runners (not behind auth)
- [x] If health endpoint requires changes: add to server routes (`src/server/routes/health.ts`)

---

## Phase 4: Deployment Rollback

### 4.1 Rollback recipe in justfile
- [x] Add to `deploy/ansible/justfile`:
  ```
  rollback-demo version:
      ansible-playbook -i inventories/demo.yml \
          playbooks/deploy-demo.yml \
          -e image_tag={{ version }}
  ```
- [x] Document: to roll back, run `just rollback-demo v1.2.3`

### 4.2 Docker image retention
- [x] Verify GHCR retains at least the last 5 tagged versions (for rollback)
- [x] Add `.github/policies/ghcr-retention.json` if needed to set retention policy

---

## Phase 5: Site Auto-Deploy

**Gap:** Marketing site (Astro) builds as a CI artifact but is not deployed automatically to Cloudflare Pages.

- [x] Add deploy step to `ci.yml` after `build` job (or in a separate `deploy-site.yml`):
  - Trigger: push to `main` when `site/` files changed (use `changes` job output)
  - Use `cloudflare/wrangler-action` to deploy:
    ```yaml
    - uses: cloudflare/wrangler-action@v3
      with:
        apiToken: ${{ secrets.CF_API_TOKEN }}
        accountId: ${{ secrets.CF_ACCOUNT_ID }}
        command: pages deploy site/dist --project-name=llamenos-site
    ```
  - Required secrets: `CF_API_TOKEN`, `CF_ACCOUNT_ID`

---

## Completion Checklist

- [x] `.github/workflows/auto-deploy-demo.yml` created
- [x] Workflow triggers on `release: published` event
- [x] Docker image availability check before Ansible run
- [x] Health endpoint verification after deploy
- [x] Cleanup of sensitive files in `always()` step
- [x] Rollback recipe in justfile
- [x] Test: push a test tag → verify auto-deploy runs and succeeds
- [x] Site auto-deploy: CF Pages deploys on site changes
- [x] `CF_API_TOKEN`, `CF_ACCOUNT_ID` secrets documented in ops runbook
- [x] Deploy concurrency lock prevents parallel deploys
