# Deployment Hardening Guide

This guide provides security-focused deployment recommendations for Llamenos operators. Since Llamenos is self-hosted open-source software, the operator is responsible for infrastructure security. This document covers three deployment architectures in order of complexity.

## Architecture Overview

| Architecture | Best For | Complexity | Security Surface |
|---|---|---|---|
| **Docker Compose on VPS** | Small orgs (1-10 volunteers) | Low | Single server, all services co-located |
| **Kubernetes (Helm)** | Medium-large orgs (10-100+ volunteers) | High | Multi-node, network policies, pod isolation |
| **Cloudflare Workers** | Any size; managed infrastructure | Medium | Cloudflare as trusted party; no server management |

All three architectures provide E2EE for call notes and transcriptions. The security of the cryptographic layer is independent of the deployment model — the server never has access to plaintext note content regardless of where it runs.

---

## 1. Docker Compose on VPS (Recommended for Small Deployments)

### VPS Selection

**Recommended providers** (privacy-focused, GDPR-compliant):
- Hetzner (Germany/Finland) — good privacy track record, EU jurisdiction
- OVH (France) — EU jurisdiction, dedicated servers available
- Greenhost (Netherlands) — privacy-focused nonprofit hosting

**Avoid**:
- US-based providers subject to NSLs/FISA (unless operating under US jurisdiction)
- Providers without full-disk encryption at the hypervisor level
- Shared hosting / VPS with known noisy-neighbor attacks

**Minimum specifications**:
- 2 vCPU, 4GB RAM, 40GB SSD
- Dedicated IP (not shared)
- KVM or dedicated hardware (avoid OpenVZ — no kernel isolation)

### VPS Hardening with Ansible

We provide an Ansible playbook for automated VPS hardening. This is the recommended approach for operators who are not Linux security specialists.

```bash
# Clone the deployment repo
git clone https://github.com/llamenos/deploy-ansible.git
cd deploy-ansible

# Configure your inventory
cp inventory.example.yml inventory.yml
# Edit inventory.yml with your VPS IP, SSH key, domain name

# Run the hardening playbook
ansible-playbook -i inventory.yml playbooks/harden.yml

# Deploy Llamenos
ansible-playbook -i inventory.yml playbooks/deploy.yml
```

The hardening playbook performs:

#### OS-Level Hardening
- **Unattended security updates** (`unattended-upgrades` with security-only sources)
- **SSH hardening**: Disable password auth, disable root login, change default port, `AllowUsers` whitelist, `MaxAuthTries 3`
- **Firewall** (UFW): Allow only 22 (SSH, custom port), 80, 443. Deny all other inbound.
- **Kernel hardening** (`sysctl.conf`):
  ```
  net.ipv4.conf.all.rp_filter = 1           # Strict reverse path filtering
  net.ipv4.conf.all.accept_redirects = 0     # Ignore ICMP redirects
  net.ipv4.conf.all.send_redirects = 0
  net.ipv6.conf.all.accept_redirects = 0
  kernel.dmesg_restrict = 1                  # Restrict dmesg to root
  kernel.kptr_restrict = 2                   # Hide kernel pointers
  fs.protected_hardlinks = 1
  fs.protected_symlinks = 1
  ```
- **Fail2ban**: SSH brute-force protection (5 attempts, 1-hour ban)
- **Audit logging** (`auditd`): Log file access, user changes, privilege escalation
- **Disable unused services**: `bluetooth`, `cups`, `avahi-daemon`
- **Automatic reboots** for kernel updates (configurable schedule)

#### Docker-Specific Hardening
- Docker configured with `userns-remap` (user namespace isolation)
- Docker socket not exposed to containers
- Docker content trust enabled (`DOCKER_CONTENT_TRUST=1`)
- Log rotation configured (max 10MB per container, 3 files)
- `no-new-privileges` security option enabled globally

#### Network Hardening
- Caddy as reverse proxy with automatic TLS (Let's Encrypt)
- OCSP stapling enabled
- TLS 1.2 minimum (TLS 1.3 preferred)
- HTTP/2 and HTTP/3 enabled
- Security headers applied at Caddy layer (see Caddyfile in repo)

### Secrets Management

For Docker Compose deployments, secrets are managed via environment variables in a `.env` file:

```bash
# Generate secrets
openssl rand -hex 32 > /dev/null  # Example: use for PG_PASSWORD, BRIDGE_SECRET

# Create .env from example
cp .env.example .env

# Set required secrets (NEVER commit .env to version control)
# PG_PASSWORD=<generated>
# ADMIN_PUBKEY=<from bootstrap-admin script>
# BRIDGE_SECRET=<generated>
# ARI_PASSWORD=<if using Asterisk>
```

**File permissions**:
```bash
chmod 600 .env
chown root:root .env
```

### Backup Strategy

```bash
# Database backup (encrypted, automated)
# Add to crontab: 0 3 * * * /opt/llamenos/backup.sh

#!/bin/bash
BACKUP_DIR=/opt/llamenos/backups
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/llamenos_$DATE.sql.gz.age"

# Dump and compress
docker compose exec -T postgres pg_dump -U llamenos llamenos \
  | gzip \
  | age -r "age1..." \  # Operator's age public key
  > "$BACKUP_FILE"

# Rotate: keep 30 days
find "$BACKUP_DIR" -name "*.age" -mtime +30 -delete

# Optional: upload to encrypted off-site storage
# rclone copy "$BACKUP_FILE" remote:llamenos-backups/
```

### Monitoring

- **Uptime monitoring**: Use an external service (UptimeRobot, Healthchecks.io) to ping `/api/health`
- **Log aggregation**: Docker logs are written to stdout; use `docker compose logs --follow` or ship to a log aggregator
- **Disk space alerts**: Monitor `/var/lib/docker` and PostgreSQL data directory
- **Certificate expiry**: Caddy handles automatic renewal; monitor for failures

---

## 2. Kubernetes Deployment (Helm Chart)

The Helm chart provides production-grade Kubernetes deployment with security defaults.

### Prerequisites

- Kubernetes 1.28+ with a CNI that enforces NetworkPolicy (Calico or Cilium recommended)
- Ingress controller (nginx-ingress or Traefik)
- cert-manager for TLS certificate management
- External Secrets Operator or Vault for secret injection (recommended)

### Security Defaults in the Helm Chart

The chart enforces these security contexts by default:

```yaml
# Pod security
runAsNonRoot: true
runAsUser: 1000
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
automountServiceAccountToken: false

# Network isolation
networkPolicy:
  enabled: true  # Default: true
  # App pod: ingress only from ingress controller
  # App pod: egress only to DNS, MinIO, Whisper, external HTTPS
  # MinIO pod: ingress only from app pod
```

### Required Values

```yaml
# values.yaml — minimum for production
config:
  adminPubkey: "<from bootstrap-admin>"
  environment: "production"

database:
  external: true
  host: "your-rds-instance.region.rds.amazonaws.com"
  port: 5432
  name: "llamenos"
  existingSecret: "llamenos-db-credentials"  # Use External Secrets Operator

ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: hotline.yourdomain.org
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: llamenos-tls
      hosts:
        - hotline.yourdomain.org

# Resource limits (adjust based on expected load)
resources:
  limits:
    cpu: "1"
    memory: "512Mi"
  requests:
    cpu: "250m"
    memory: "256Mi"
```

### Hardening Checklist for Kubernetes

- [ ] Enable etcd encryption at rest (for Kubernetes Secrets)
- [ ] Use External Secrets Operator or Vault — never store secrets in plaintext `values.yaml`
- [ ] Enable PodDisruptionBudget if running multiple replicas
- [ ] Configure Horizontal Pod Autoscaler for the app deployment
- [ ] Enable audit logging on the Kubernetes API server
- [ ] Use a service mesh (Linkerd or Istio) for mTLS between pods (optional but recommended)
- [ ] Restrict `kubectl` access with RBAC — separate admin and operator roles
- [ ] Run `kube-bench` to validate CIS Kubernetes Benchmark compliance

---

## 3. Cloudflare Workers Deployment

### Security Advantages

- No server to manage — no OS patching, no SSH keys to rotate
- DDoS protection included at the edge
- Durable Objects provide transactional consistency without database management
- R2 for encrypted file storage with no public access
- Automatic TLS with edge termination

### Security Considerations

- **Cloudflare is a trusted party**: They can access Worker memory, DO storage, and R2 blobs. E2EE ensures they cannot read note content.
- **Account security is critical**: Enable 2FA, use API tokens (not global key), restrict token permissions to the minimum required.
- **`workers_dev: false`** is set by default — do not change this (prevents alternate origin).
- **Secrets**: Use `wrangler secret put` — never put secrets in `wrangler.jsonc` or source control.

### Hardening Checklist for Cloudflare

- [ ] Enable 2FA on the Cloudflare account
- [ ] Use API tokens scoped to the specific Worker/account
- [ ] Enable Cloudflare Access or IP allowlisting for the Cloudflare dashboard
- [ ] Set up Cloudflare audit logs and alert on Worker deployments
- [ ] Use a separate Cloudflare account for the hotline (isolate from other projects)
- [ ] Enable Bot Management if available (additional call spam protection)
- [ ] Configure custom WAF rules for the API endpoints

---

## OpenTofu for Infrastructure-as-Code

For operators who want reproducible, version-controlled infrastructure, we provide OpenTofu modules for provisioning the VPS and networking layer.

### Why OpenTofu (Not Terraform)

OpenTofu is the open-source fork of Terraform maintained by the Linux Foundation. It is license-compatible with self-hosted open-source projects (MPL 2.0) and avoids the BSL licensing concerns of HashiCorp Terraform.

### VPS Provisioning with OpenTofu

```hcl
# main.tf — Hetzner Cloud example
terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
  }
}

resource "hcloud_server" "llamenos" {
  name        = "llamenos-hotline"
  image       = "ubuntu-24.04"
  server_type = "cpx21"  # 3 vCPU, 4GB RAM
  location    = "fsn1"   # Falkenstein, Germany

  ssh_keys = [hcloud_ssh_key.deploy.id]

  # Cloud-init for initial hardening
  user_data = file("${path.module}/cloud-init.yml")

  # Firewall
  firewall_ids = [hcloud_firewall.llamenos.id]
}

resource "hcloud_firewall" "llamenos" {
  name = "llamenos-fw"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_ssh_cidrs  # Restrict SSH to known IPs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]  # Caddy HTTP->HTTPS redirect
  }
}
```

### Workflow

```bash
# 1. Provision infrastructure
cd deploy/opentofu
tofu init
tofu plan -var-file=production.tfvars
tofu apply -var-file=production.tfvars

# 2. Harden the server
cd ../ansible
ansible-playbook -i inventory.yml playbooks/harden.yml

# 3. Deploy Llamenos
ansible-playbook -i inventory.yml playbooks/deploy.yml
```

---

## Operational Security Procedures

### Key Management

1. **Admin keypair**: Generate with `bun run bootstrap-admin`. Store the nsec in a password manager or hardware security module. NEVER reuse this keypair on public Nostr relays or other services.

2. **Volunteer onboarding**: Use the invite system. Each volunteer generates their own keypair in-browser during onboarding. The nsec never leaves their device.

3. **Key rotation**: Currently not automated. If an admin key is compromised, generate a new keypair, re-bootstrap (after clearing the existing admin), and re-encrypt all admin-wrapped note keys. This requires all volunteers to be online to re-wrap their notes.

4. **Device decommissioning**: When a volunteer leaves, deactivate their account (this revokes all sessions immediately). Their encrypted notes remain readable by admin but the volunteer can no longer log in.

### Incident Response

1. **Volunteer account compromise**:
   - Immediately deactivate the account in admin panel (sessions auto-revoked)
   - The compromised volunteer's V2 notes remain protected by forward secrecy — the attacker cannot decrypt past notes without the per-note ephemeral keys
   - V1 notes (if any) are exposed — migrate all V1 notes to V2 immediately
   - Generate a new invite for the volunteer to re-onboard with a fresh keypair

2. **Server compromise (Cloudflare/VPS)**:
   - E2EE notes are safe — server has no plaintext
   - Rotate all telephony credentials (Twilio auth token, etc.)
   - Rotate `ADMIN_PUBKEY` if the server had access to admin operations
   - Review audit logs for unauthorized actions during the compromise window
   - Notify volunteers to re-authenticate (their keys are client-side, not affected)

3. **CI/CD compromise**:
   - Rotate all GitHub repository secrets
   - Audit recent commits and deployments
   - Rebuild and redeploy from a known-good commit
   - Review GitHub Actions logs for unauthorized workflow runs

### Regular Maintenance

| Task | Frequency | How |
|------|-----------|-----|
| OS security updates | Daily (automated) | `unattended-upgrades` or Ansible |
| Dependency audit | Weekly | `bun audit` or Dependabot |
| TLS certificate renewal | Automatic | Caddy / cert-manager |
| Database backups | Daily | Automated script (encrypted) |
| Audit log review | Weekly | Admin panel or database query |
| Key rotation (telephony) | Quarterly | Regenerate provider API keys |
| Docker image updates | Monthly | Pull latest base images, rebuild |
| Penetration testing | Annually | Engage external security firm |

---

## Compliance Notes

### GDPR (EU)

- **Data controller**: The organization operating the hotline
- **Data processor**: Cloud provider (Cloudflare, VPS host)
- **Data processing agreement**: Required with the cloud provider
- **Right to erasure**: Admin can delete volunteer accounts and notes
- **Data minimization**: Phone numbers hashed, caller numbers not stored in plaintext
- **Encryption**: E2EE for notes satisfies Article 32 (security of processing)
- **Breach notification**: 72-hour window — monitor audit logs for unauthorized access

### HIPAA (US, if applicable)

- Llamenos does NOT claim HIPAA compliance out of the box
- If used in a healthcare context, additional BAAs with cloud providers are required
- Audit logging satisfies some HIPAA requirements
- E2EE notes satisfy the encryption at-rest and in-transit requirements

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-23 | 1.0 | Initial deployment hardening guide |
