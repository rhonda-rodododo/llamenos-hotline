# Local VM Testing for Ansible Deployment

**Date:** 2026-03-25
**Status:** Complete
**Goal:** Validate the entire Ansible deployment pipeline against a local VM before touching a real VPS, so the first production deploy is flawless.

## Context

The Ansible deployment infrastructure (`deploy/ansible/`) is fully written but has never been run against a real target. It includes:
- 6 hardening roles (common, ssh, firewall, kernel, fail2ban, docker)
- Application deployment (docker-compose with app, postgres, caddy, minio, strfry)
- Backup/restore system
- Rolling update with health-check rollback
- Demo instance management

The Linux workstation is low on disk. The M4 Mac (accessible via `ssh mac`) has:
- **macOS 26.3.1** (Tahoe), M4 chip, 10 cores, 16GB RAM, ~50GB free disk
- **Docker Desktop 29.2.1** installed (CLI at `/usr/local/bin/docker`)
- **No Homebrew** yet — needs installing first
- **No Ansible, Tart, or just** — all need installing via Homebrew
- SSH PATH is restricted (`/usr/bin:/bin:/usr/sbin:/sbin`) — tools installed via Homebrew need full paths or a login shell

## Step 0: Bootstrap the Mac

```bash
# Install Homebrew (if not present)
ssh mac '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

# Add Homebrew to shell profile
ssh mac 'echo "eval \"\$(/opt/homebrew/bin/brew shellenv)\"" >> ~/.zprofile'

# Install required tools (use full path until shell profile is reloaded)
ssh mac '/opt/homebrew/bin/brew install ansible just cirruslabs/cli/tart'

# Verify
ssh mac 'source ~/.zprofile && ansible --version && just --version && tart --version'
```

## VM Tool: Tart (recommended)

[Tart](https://github.com/cirruslabs/tart) is the best fit for this use case:
- Native Apple Virtualization Framework (near-native ARM64 performance)
- CLI-only — perfect for SSH-driven automation
- Ubuntu Server ARM64 images available via OCI
- Headless operation, SSH access out of the box
- Homebrew install: `brew install cirruslabs/cli/tart`

**Alternatives considered:**
| Tool | Why not |
|------|---------|
| UTM | GUI-focused, harder to automate from SSH |
| Multipass | Good but Tart is faster on Apple Silicon |
| Vagrant + QEMU | Heavy, slower emulation layer |
| OrbStack | Docker-focused, VM support is secondary |
| Lima | Good option but Tart is more straightforward for full VMs |

If Tart is already installed or another VM tool is preferred, adapt accordingly — the spec is tool-agnostic in its testing steps.

## Prerequisites

### On the Mac (`ssh mac`)

```bash
# 1. Install Tart
brew install cirruslabs/cli/tart

# 2. Pull Ubuntu 24.04 Server (ARM64, ~500MB)
tart clone ghcr.io/cirruslabs/ubuntu:24.04 llamenos-test

# 3. Optionally increase resources (match a small VPS)
tart set llamenos-test --cpu 2 --memory 4096 --disk-size 20

# 4. Start the VM headless
tart run llamenos-test --no-graphics &

# 5. Get the VM IP
tart ip llamenos-test
# → e.g., 192.168.64.5
```

### On the Mac — SSH key setup

```bash
# Copy your deploy key to the VM (Tart Ubuntu images use admin/admin by default)
ssh-copy-id -i ~/.ssh/id_ed25519 admin@$(tart ip llamenos-test)

# Verify SSH access
ssh admin@$(tart ip llamenos-test) "uname -a"
```

### On the Mac — prepare the VM as a fresh VPS

The VM should simulate a fresh Ubuntu VPS. Tart's Ubuntu image comes with a default `admin` user with sudo. This mirrors a typical VPS initial state where you SSH in as a non-root user with sudo.

```bash
VM_IP=$(tart ip llamenos-test)

# Ensure sudo works without password (typical VPS setup)
ssh admin@$VM_IP "sudo whoami"

# Verify systemd is running (required for our roles)
ssh admin@$VM_IP "systemctl is-system-running || true"
```

## Test Inventory & Variables

### `deploy/ansible/inventory-local-vm.yml`

```yaml
# Local VM testing inventory — NOT committed to git
all:
  children:
    production:
      hosts:
        llamenos-test:
          ansible_host: "{{ lookup('pipe', 'ssh mac tart ip llamenos-test') }}"
          ansible_user: admin
          ansible_ssh_private_key_file: ~/.ssh/id_ed25519
          ansible_port: 22
          ansible_become: true
          # Jump through the Mac to reach the VM
          ansible_ssh_common_args: '-o ProxyJump=mac'
```

**Note on ProxyJump:** The VM is on the Mac's private network (192.168.64.x). From the Linux workstation, we SSH through the Mac to reach it. This requires the Mac's `~/.ssh/id_ed25519` to be authorized on the VM OR the Linux key to be forwarded.

**Alternative — run Ansible from the Mac directly:**
```bash
# Clone the repo on the Mac and run Ansible there (simpler networking)
ssh mac "cd ~/projects/llamenos-hotline && cd deploy/ansible && just deploy"
```

### `deploy/ansible/vars-local-vm.yml`

```yaml
# Local VM test variables — NOT committed to git
# Uses .local domain since no real DNS / Let's Encrypt available

domain: llamenos.local
acme_email: test@llamenos.local

# Skip real TLS — use Caddy's internal CA or HTTP-only for local testing
# We'll need a small Caddyfile tweak for local mode (see Phase 3)

ssh_port: 2222
ssh_allowed_cidrs:
  - "0.0.0.0/0"  # Fine for local VM

deploy_user: deploy
deploy_group: deploy

# Build the Docker image locally instead of pulling from GHCR
# (image doesn't exist on GHCR yet)
llamenos_image: llamenos:local

caddy_image: caddy:2.9-alpine
postgres_image: postgres:17-alpine
minio_image: minio/minio:RELEASE.2025-01-20T14-49-07Z

app_dir: /opt/llamenos
hotline_name: "Test Hotline"
environment: development

# Generate test secrets (not real — local VM only)
admin_pubkey: "<generate with: bun run bootstrap-admin>"
admin_decryption_pubkey: "<same as above>"
hmac_secret: "<generate with: openssl rand -hex 32>"
server_nostr_secret: "<generate with: openssl rand -hex 32>"

pg_password: "<generate with: openssl rand -base64 24>"
pg_pool_size: 5

minio_access_key: "<generate with: openssl rand -base64 24>"
minio_secret_key: "<generate with: openssl rand -base64 24>"
minio_bucket: llamenos-files
minio_app_user: llamenos-app
minio_app_password: "<generate with: openssl rand -base64 24>"

twilio_account_sid: ""
twilio_auth_token: ""
twilio_phone_number: ""

compose_profiles: []
backup_enabled: false
docker_userns_remap: true
firewall_extra_ports: []
timezone: UTC
locale: en_US.UTF-8
```

## Test Phases

### Phase 0: Build the Docker Image (ARM64)

The app image doesn't exist on GHCR yet, so we build locally on the Mac (ARM64 native):

```bash
# On the Mac — build the image
ssh mac "cd ~/projects/llamenos-hotline && docker build -f deploy/docker/Dockerfile -t llamenos:local ."

# Save and load into the VM (or run a local registry)
ssh mac "docker save llamenos:local | gzip > /tmp/llamenos-local.tar.gz"
ssh mac "cat /tmp/llamenos-local.tar.gz | ssh admin@\$(tart ip llamenos-test) 'gunzip | sudo docker load'"
```

**Alternative — local registry on the Mac:**
```bash
ssh mac "docker run -d -p 5000:5000 --name registry registry:2"
ssh mac "docker tag llamenos:local localhost:5000/llamenos:local && docker push localhost:5000/llamenos:local"
# Then set llamenos_image: <mac-ip>:5000/llamenos:local in vars
```

### Phase 1: Preflight Validation

Verify variable validation catches bad input before anything touches the server.

```bash
cd deploy/ansible

# Should PASS with properly filled vars
ansible-playbook playbooks/preflight.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"

# Should FAIL with empty/bad values (test the guard rails)
ansible-playbook playbooks/preflight.yml -i inventory-local-vm.yml --extra-vars "domain='' admin_pubkey='short'"
```

**Pass criteria:** Preflight rejects invalid inputs with clear error messages.

### Phase 2: Server Hardening

Run the hardening playbook and verify each layer:

```bash
ansible-playbook playbooks/harden.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
```

**Verification checklist:**

| Check | Command (run on VM) | Expected |
|-------|---------------------|----------|
| SSH port changed | `ss -tlnp \| grep 2222` | LISTEN on 2222 |
| SSH password auth disabled | `grep PasswordAuthentication /etc/ssh/sshd_config` | `no` |
| UFW active | `sudo ufw status` | active, rules for 2222/80/443 |
| Fail2ban running | `systemctl is-active fail2ban` | active |
| Docker installed | `docker --version` | Docker CE |
| Docker userns remap | `grep dockremap /etc/docker/daemon.json` | present |
| Kernel hardening | `sysctl net.ipv4.tcp_syncookies` | = 1 |
| Deploy user exists | `id deploy` | uid/gid present |
| NTP synced | `chronyc tracking` | Reference ID not 0.0.0.0 |

**After hardening, update inventory port:**
```yaml
ansible_port: 2222  # SSH moved by hardening
```

### Phase 3: Application Deployment

```bash
ansible-playbook playbooks/deploy.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
```

**Known issue — TLS:** Caddy will fail to get a Let's Encrypt cert for `llamenos.local`. Two options:

**Option A — Caddy internal TLS (recommended for local):**
Add a conditional to the Caddy template or override:
```
llamenos.local {
    tls internal
    ...
}
```
This uses Caddy's built-in CA — self-signed but functional.

**Option B — HTTP only:**
Use `http://llamenos.local` in the Caddyfile (Caddy serves plain HTTP).

We may need a small template variable like `tls_mode: internal | acme` to support this without forking the template. This is the one expected code change.

**Verification checklist:**

| Check | Command (run on VM) | Expected |
|-------|---------------------|----------|
| Containers running | `docker compose -f /opt/llamenos/docker-compose.yml ps` | app, postgres, caddy, minio, strfry all Up |
| App health | `curl -f http://localhost:3000/api/health/ready` | 200 OK |
| Caddy proxying | `curl -k https://localhost/api/health/ready` | 200 OK (self-signed) |
| PostgreSQL healthy | `docker exec llamenos-postgres pg_isready` | accepting connections |
| MinIO healthy | `docker exec llamenos-minio mc ready local` | ready |
| Strfry healthy | `curl -f http://localhost:7777` | response |
| Systemd service | `systemctl is-active llamenos` | active |
| Survives reboot | `sudo reboot` → wait → re-check all above | all services back up |

### Phase 4: Smoke Test the Application

From the Linux workstation, tunnel through the Mac to the VM:

```bash
# SSH tunnel: localhost:8443 → VM:443
ssh -L 8443:$(ssh mac "tart ip llamenos-test"):443 mac -N &

# Open in browser
# https://localhost:8443 (accept self-signed cert)
```

**Manual smoke test:**
- [ ] Login page loads
- [ ] Admin can authenticate with bootstrap keypair
- [ ] WebAuthn registration works (or gracefully degrades in VM)
- [ ] Settings page loads
- [ ] Language switching works
- [ ] API calls succeed (check browser console for errors)

### Phase 5: Rolling Update

Test the update workflow:

```bash
# Rebuild image with a small change (e.g., bump BUILD_VERSION)
ssh mac "cd ~/projects/llamenos-hotline && docker build -f deploy/docker/Dockerfile --build-arg BUILD_VERSION=test-update -t llamenos:local ."
# Load into VM...

ansible-playbook playbooks/update.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
```

**Verification:**
- [ ] Pre-update backup runs (if enabled)
- [ ] New image pulled / loaded
- [ ] Health check passes after restart
- [ ] App serves the updated version

**Rollback test:**
```bash
# Deliberately break the image (e.g., bad CMD)
# Run update — should auto-rollback when health check fails
```

### Phase 6: Backup & Restore (optional)

If backup is enabled in test vars:

```bash
ansible-playbook playbooks/backup.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
ansible-playbook playbooks/test-restore.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
```

### Phase 7: Idempotency

Run the full setup twice — second run should report 0 changed:

```bash
ansible-playbook setup.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
# Run again:
ansible-playbook setup.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"
# Check: "changed=0" on second run (or minimal, expected changes)
```

## Expected Code Changes

Based on the review, these are likely issues we'll discover and fix:

### 1. TLS Mode for Local Testing
**File:** `deploy/ansible/roles/llamenos/templates/caddy.j2`
**Change:** Add `tls_mode` variable (default: `acme`, option: `internal`) so local VMs can use Caddy's internal CA.

### 2. ARM64 Compatibility
The Docker images used (postgres:17-alpine, caddy:2.9-alpine, minio, strfry) all have ARM64 variants. The app Dockerfile uses `oven/bun` which also supports ARM64. **No changes expected**, but verify strfry has an ARM64 image.

### 3. First-Run SSH Port Chicken-and-Egg
The hardening playbook changes SSH to port 2222, but the inventory starts at port 22. After hardening, subsequent runs need port 2222. This is already noted in `inventory.example.yml` comments but may need a smoother workflow (e.g., `ansible_port` auto-detection or a variable).

### 4. Initial `deploy` User Creation
The `common` role creates the `deploy` user, but the first run connects as `admin` (the Tart default) or `root` (typical VPS). The inventory needs `ansible_user: admin` for the first run, then switch to `deploy` after. This mirrors real VPS behavior — document the two-phase flow.

### 5. Docker Image Loading
For local testing without GHCR, we need a way to get the image into the VM. The spec covers this (docker save/load or local registry), but we might want a `just load-image-to-vm` command.

## Automation: `just` Commands for VM Testing

Add to `deploy/ansible/justfile`:

```just
# ─── Local VM Testing ──────────────────────────────────────────
# Requires: Tart on Mac, SSH access via 'mac' host

vm-create:
    ssh mac "tart clone ghcr.io/cirruslabs/ubuntu:24.04 llamenos-test && tart set llamenos-test --cpu 2 --memory 4096 --disk-size 20"

vm-start:
    ssh mac "tart run llamenos-test --no-graphics &"

vm-stop:
    ssh mac "tart stop llamenos-test"

vm-destroy:
    ssh mac "tart delete llamenos-test"

vm-ip:
    ssh mac "tart ip llamenos-test"

vm-ssh:
    ssh -J mac admin@$(ssh mac "tart ip llamenos-test")

vm-build-image:
    ssh mac "cd ~/projects/llamenos-hotline && docker build -f deploy/docker/Dockerfile -t llamenos:local ."

vm-load-image:
    ssh mac 'docker save llamenos:local | gzip | ssh admin@$(tart ip llamenos-test) "gunzip | sudo docker load"'

vm-test-deploy:
    ansible-playbook setup.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"

vm-test-harden:
    ansible-playbook playbooks/harden.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"

vm-test-update:
    ansible-playbook playbooks/update.yml -i inventory-local-vm.yml --extra-vars "@vars-local-vm.yml"

vm-tunnel:
    @echo "Opening tunnel to VM on localhost:8443..."
    ssh -L 8443:$(ssh mac "tart ip llamenos-test"):443 mac -N
```

## Reset & Iterate

To start fresh after a failed test:

```bash
# Option A: Destroy and recreate (clean slate, ~2 min)
just vm-destroy && just vm-create && just vm-start

# Option B: Snapshot and restore (faster iteration)
ssh mac "tart stop llamenos-test && tart clone llamenos-test llamenos-test-snapshot"
# After testing:
ssh mac "tart delete llamenos-test && tart clone llamenos-test-snapshot llamenos-test"
```

## Success Criteria

The deployment is considered validated when ALL of these pass:

- [x] **Preflight** rejects bad input, accepts good input
- [x] **Hardening** completes — SSH, firewall, kernel, fail2ban, Docker all verified
- [x] **Deploy** completes — all 5 containers healthy, systemd service active
- [x] **App accessible** via HTTPS tunnel — SPA loads, all assets 200, security headers present
- [x] **Update** works — health check passes after restart
- [ ] **Rollback** works — broken image triggers automatic rollback (not tested — needs bad image)
- [x] **Idempotent** — second harden run: 0 failures, 9 changed (UFW resets only)
- [x] **Reboot survival** — all 5 containers back up with 15s uptime after reboot

Once all checks pass, we can confidently deploy to a real VPS by:
1. Swapping the inventory IP to the real VPS
2. Using real secrets in vars.yml
3. Setting `domain` to the real domain (for Let's Encrypt)
4. Running `just setup-all`

## Open Questions

1. ~~**strfry ARM64 image**~~ — **Confirmed:** `dockurr/strfry:latest` has both `amd64` and `arm64` manifests. No issue.
2. **Ansible on Mac vs Linux** — Running Ansible from the Mac (simpler networking) vs from Linux (ProxyJump, more complex). **Recommend Mac-local** — the Mac needs the repo for Docker builds anyway, and avoids ProxyJump complexity.
3. **Repo on Mac** — Clone the repo to `~/projects/llamenos-hotline` on the Mac. Run Ansible and Docker builds there directly.
4. **VM networking** — Tart uses macOS Virtualization.framework networking. The VM gets a private IP on a bridge. Verify it can pull Docker images (outbound internet access).
5. **Docker Desktop vs Colima** — Docker Desktop is installed but Colima might be lighter for just building images. Docker Desktop works fine for our needs.
