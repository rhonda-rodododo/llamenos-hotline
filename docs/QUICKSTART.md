# Quick Start Guide

This guide walks you through deploying Llamenos on a self-hosted VPS from scratch. By the end, you will have a running crisis hotline with TLS, database backups, and an admin account.

**Time estimate**: 30-60 minutes (manual), or 15 minutes with Ansible.

**Audience**: Sysadmins deploying Llamenos for an organization. Familiarity with Linux, SSH, and Docker is assumed.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Provision a VPS](#2-provision-a-vps)
3. [Initial Server Hardening](#3-initial-server-hardening)
4. [Deploy the Application](#4-deploy-the-application)
5. [Configure Telephony](#5-configure-telephony)
6. [Test the Deployment](#6-test-the-deployment)
7. [Update the Application](#7-update-the-application)

---

## 1. Prerequisites

Before you begin, you need:

- **A domain name** pointed at your server (e.g., `hotline.yourorg.org`). An A record pointing to your VPS IP is sufficient. Caddy handles TLS certificates automatically via Let's Encrypt.
- **SSH key pair** for server access. If you do not have one, generate it:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/llamenos_deploy -C "llamenos-deploy"
  ```
- **A VPS** meeting the minimum specifications (see Section 2).
- **Docker** with Docker Compose v2 (installed during hardening step).
- **`openssl`** (pre-installed on most Linux systems).
- **A telephony provider account** (e.g., Twilio) with a phone number, if you want voice calling. You can configure telephony later through the admin UI.

### Optional Tools

- **Ansible** (2.15+) -- for automated server hardening and deployment. Install: `pip install ansible`
- **OpenTofu** (1.6+) -- for infrastructure-as-code VPS provisioning. Install: [opentofu.org/docs/intro/install](https://opentofu.org/docs/intro/install/)

---

## 2. Provision a VPS

### Recommended Providers

Choose a privacy-respecting, GDPR-compliant provider with EU data centers:

| Provider | Location | Notes |
|----------|----------|-------|
| **Hetzner** | Germany, Finland | Strong privacy record, EU jurisdiction, best value |
| **OVH** | France | EU jurisdiction, dedicated servers available |
| **Greenhost** | Netherlands | Privacy-focused nonprofit hosting |

**Avoid** US-based providers subject to National Security Letters (NSLs) and FISA court orders unless your organization operates under US jurisdiction.

### Minimum Specifications

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 vCPU | 3+ vCPU |
| RAM | 4 GB | 4 GB |
| Disk | 40 GB SSD | 80 GB SSD |
| Network | Dedicated IP | Dedicated IP |
| Virtualization | KVM or dedicated | KVM or dedicated |

**WARNING**: Do not use OpenVZ containers -- they share the host kernel and cannot enforce the kernel hardening parameters described in this guide.

### Option A: Manual VPS Provisioning

1. Create a VPS through your provider's dashboard.
2. Select **Ubuntu 24.04 LTS** as the operating system.
3. Add your SSH public key during creation.
4. Note the server's IP address.

### Option B: Automated Provisioning with OpenTofu

If you prefer infrastructure-as-code, use the OpenTofu modules in `deploy/opentofu/`. This example uses Hetzner Cloud:

```bash
cd deploy/opentofu

# Create your variables file
cat > production.tfvars <<'EOF'
hcloud_token     = "your-hetzner-api-token"
server_type      = "cpx21"       # 3 vCPU, 4 GB RAM
location         = "fsn1"        # Falkenstein, Germany
ssh_key_path     = "~/.ssh/llamenos_deploy.pub"
admin_ssh_cidrs  = ["YOUR_IP/32"]
EOF

# Provision the server
tofu init
tofu plan -var-file=production.tfvars
tofu apply -var-file=production.tfvars
```

The output includes the server IP address and a generated Ansible inventory file.

### DNS Configuration

Create an A record for your domain pointing to the server IP:

```
hotline.yourorg.org.  IN  A  203.0.113.10
```

Wait for DNS propagation before proceeding. You can verify with:

```bash
dig +short hotline.yourorg.org
```

---

## 3. Initial Server Hardening

**SECURITY WARNING**: A default VPS is not hardened. You must apply security configurations before deploying the application. An unhardened server with SSH password auth and no firewall undermines all of the application's E2EE protections.

### Option A: Automated Hardening with Ansible (Recommended)

This is the recommended approach. The Ansible playbook applies all hardening measures idempotently -- it is safe to run multiple times.

```bash
cd deploy/ansible

# Create your inventory file
cp inventory.example.yml inventory.yml
```

Edit `inventory.yml` with your server details:

```yaml
all:
  hosts:
    llamenos:
      ansible_host: 203.0.113.10        # Your VPS IP
      ansible_user: root                  # Use root for the first run
      ansible_ssh_private_key_file: ~/.ssh/llamenos_deploy
      ansible_port: 22                    # Will change to ssh_port after hardening
```

Run the hardening playbook:

```bash
ansible-playbook -i inventory.yml playbooks/harden.yml
```

The playbook performs:

- Creates a `deploy` user with sudo access and disables root SSH login
- Disables SSH password authentication; restricts to key-based auth only
- Changes SSH port (default: 2222; configurable via `ssh_port` variable)
- Configures UFW firewall (allows SSH, HTTP 80, HTTPS 443 only)
- Applies kernel hardening via `sysctl` (reverse path filtering, ICMP redirect blocking, dmesg restriction, kernel pointer hiding)
- Installs and configures fail2ban (SSH brute-force protection: 5 attempts, 1-hour ban)
- Enables unattended security updates (`unattended-upgrades`)
- Installs and configures auditd (file access, privilege escalation, user change logging)
- Installs Docker with security options (`userns-remap`, `no-new-privileges`, log rotation)
- Disables unnecessary services (bluetooth, cups, avahi-daemon)
- Configures NTP for accurate timestamps (required for Schnorr token validation)

After hardening, update your inventory to use the new SSH port and the `deploy` user:

```yaml
all:
  hosts:
    llamenos:
      ansible_host: 203.0.113.10
      ansible_user: deploy
      ansible_ssh_private_key_file: ~/.ssh/llamenos_deploy
      ansible_port: 2222
```

### Option B: Manual Hardening

If you prefer not to use Ansible, apply these steps manually. Each step corresponds to what the Ansible playbook automates.

#### 3b.1 Create a Deploy User

```bash
# SSH in as root
ssh root@203.0.113.10

# Create a non-root user
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy

# Set up SSH key auth for the new user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Allow passwordless sudo
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
```

#### 3b.2 Harden SSH

Edit `/etc/ssh/sshd_config`:

```
Port 2222
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers deploy
X11Forwarding no
```

```bash
systemctl restart sshd
```

**WARNING**: Before closing your current SSH session, open a new terminal and verify you can connect on the new port as the `deploy` user. If you lock yourself out, you will need console access from your VPS provider.

#### 3b.3 Configure Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 2222/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable
```

#### 3b.4 Kernel Hardening

Add to `/etc/sysctl.d/99-llamenos.conf`:

```
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 2
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
```

```bash
sysctl --system
```

#### 3b.5 Install fail2ban

```bash
apt update && apt install -y fail2ban

cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = 2222
maxretry = 5
bantime = 3600
findtime = 600
EOF

systemctl enable fail2ban
systemctl start fail2ban
```

#### 3b.6 Automatic Security Updates

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

#### 3b.7 Install Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Docker daemon hardening
cat > /etc/docker/daemon.json <<'EOF'
{
  "userns-remap": "default",
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker
```

---

## 4. Deploy the Application

### 4.1 Clone the Repository

```bash
ssh deploy@203.0.113.10 -p 2222

git clone https://github.com/your-org/llamenos.git /opt/llamenos
cd /opt/llamenos
```

### 4.2 Run the Setup Script

The setup script generates all required secrets and starts the application with production settings:

```bash
./scripts/docker-setup.sh --domain hotline.yourorg.org --email admin@yourorg.org
```

This will:
1. Generate cryptographically random secrets (database password, HMAC key, RustFS credentials, Nostr relay key, IdP secrets)
2. Write them to `deploy/docker/.env`
3. Build the Docker images
4. Start all services using the production Docker Compose configuration (with TLS, log rotation, and resource limits)
5. Wait for the health check to pass

### 4.3 Create the Admin Account

Visit `https://hotline.yourorg.org` in your browser. The setup wizard guides you through:

1. **Create admin account** -- register through the Authentik IdP. This creates your identity and generates a cryptographic keypair in your browser.
2. **Set your PIN** -- choose a PIN to protect your local key store. The PIN encrypts your private key material on-device.
3. **Name your hotline** -- set the display name.
4. **Choose channels** -- enable Voice, SMS, WhatsApp, Signal, and/or Reports.
5. **Configure providers** -- enter credentials for each enabled channel.
6. **Review and finish**.

Download the encrypted backup when prompted and store it in a password manager.

**SECURITY WARNING**: Your admin credentials and cryptographic keys are the master keys for your hotline. If compromised, an attacker can manage all volunteers, read admin-wrapped notes, and modify all settings. Use strong passwords, enable WebAuthn (passkey) for your Authentik account, and back up your key store securely. Never reuse credentials across services.

### 4.4 Manual Setup (Alternative)

If you prefer to configure everything manually instead of using the setup script:

```bash
cd /opt/llamenos/deploy/docker
cp .env.example .env
chmod 600 .env
```

Generate and fill in the required secrets:

```bash
# For hex secrets (HMAC_SECRET, SERVER_NOSTR_SECRET):
openssl rand -hex 32

# For passwords (PG_PASSWORD, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY):
openssl rand -base64 24

# IdP / Authentik secrets:
openssl rand -hex 32          # JWT_SECRET
openssl rand -hex 32          # IDP_VALUE_ENCRYPTION_KEY
openssl rand -hex 32          # AUTHENTIK_SECRET_KEY
openssl rand -hex 64          # AUTHENTIK_BOOTSTRAP_TOKEN
```

Set your domain and email in `.env`:

```env
DOMAIN=hotline.yourorg.org
ACME_EMAIL=admin@yourorg.org
```

Start with the production compose overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

### 4.5 Verify Services

```bash
# Check all services are running
cd /opt/llamenos/deploy/docker
docker compose -f docker-compose.yml -f docker-compose.production.yml ps

# Expected: app, postgres, caddy, rustfs, strfry, authentik-server, authentik-worker, redis all "running" with healthy status
docker compose -f docker-compose.yml -f docker-compose.production.yml logs -f app --since 1m
```

Verify the health endpoints:

```bash
# Application health
curl -s https://hotline.yourorg.org/api/health
# Expected: {"status":"ok"}

# Authentik IdP health
curl -s https://hotline.yourorg.org/idp/-/health/ready/
# Expected: 200 OK
```

---

## 5. Configure Telephony

Telephony is optional -- Llamenos works as a messaging and reporting platform without it. If you want voice calling, configure a provider.

### Twilio Setup (Most Common)

1. **Create a Twilio account** at [twilio.com](https://www.twilio.com/).
2. **Buy a phone number** with voice capability in your target region.
3. **Get your credentials** from the Twilio Console:
   - Account SID
   - Auth Token
   - Phone Number (E.164 format, e.g., `+15551234567`)

4. **Configure via the admin UI** (recommended):
   - Log in as admin.
   - Navigate to Settings > Telephony Provider.
   - Select "Twilio" from the provider dropdown.
   - Enter your Account SID, Auth Token, and Phone Number.
   - Click "Test Connection" to verify.
   - Save.

   Or add to `deploy/docker/.env`:
   ```bash
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=+15551234567
   ```
   Then restart: `docker compose -f docker-compose.yml -f docker-compose.production.yml up -d`

5. **Configure Twilio webhooks** in the Twilio Console:
   - Navigate to your phone number's configuration.
   - Set the Voice webhook URL to: `https://hotline.yourorg.org/api/telephony/twilio/voice`
   - Set the method to `POST`.
   - Set the Status Callback URL to: `https://hotline.yourorg.org/api/telephony/twilio/status`

### Other Providers

Llamenos supports five telephony providers. Configure them through the admin UI at Settings > Telephony Provider:

- **SignalWire** -- Twilio-compatible API with better pricing
- **Vonage** -- NCCO-based call control
- **Plivo** -- XML-based call control
- **Asterisk** -- Self-hosted PBX (requires the asterisk Docker profile)

For detailed setup instructions for each provider, see the documentation site or the `site/src/content/docs/` directory.

---

## 6. Test the Deployment

Run through this checklist to verify your deployment:

### Basic Functionality

- [ ] `https://hotline.yourorg.org` loads the login page
- [ ] `https://hotline.yourorg.org/api/health` returns `{"status":"ok"}`
- [ ] Authentik IdP is healthy: `curl -s https://hotline.yourorg.org/idp/-/health/ready/` returns 200
- [ ] Admin can log in via Authentik (IdP registration or passkey)
- [ ] Contact Directory is accessible from the admin panel
- [ ] TLS certificate is valid (check browser padlock icon)
- [ ] HTTP redirects to HTTPS

### Security Checks

- [ ] SSH password auth is disabled: `ssh -o PasswordAuthentication=yes deploy@server` should fail
- [ ] Only ports 80, 443, and your SSH port are open:
  ```bash
  nmap -p- hotline.yourorg.org
  ```
- [ ] Security headers are present:
  ```bash
  curl -sI https://hotline.yourorg.org | grep -E 'Strict-Transport|X-Content-Type|X-Frame|Content-Security'
  ```
- [ ] fail2ban is active: `sudo fail2ban-client status sshd`

### Nostr Relay

- [ ] Relay container is running: `docker compose ps strfry`
- [ ] `/nostr` WebSocket endpoint responds: `curl -sI https://hotline.yourorg.org/nostr` returns 426 Upgrade Required
- [ ] `SERVER_NOSTR_SECRET` is set in `.env`
- [ ] Real-time events work: open two browser tabs, verify presence updates appear

### Telephony (if configured)

- [ ] Call the hotline number from a phone
- [ ] Voice CAPTCHA plays (if enabled in settings)
- [ ] Call routes to the admin (if on shift or in the fallback group)
- [ ] Twilio webhook logs show successful requests (check Twilio Console > Monitor > Logs)

### Optional: External Monitoring

Set up uptime monitoring with an external service (UptimeRobot, Healthchecks.io, or similar) to ping:

```
https://hotline.yourorg.org/api/health
```

Alert on any non-200 response.

---

## 7. Update the Application

### Manual Update

```bash
ssh deploy@203.0.113.10 -p 2222
cd /opt/llamenos

# Pull latest code
git pull

# Rebuild and restart
cd deploy/docker
docker compose -f docker-compose.yml -f docker-compose.production.yml build app
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

### Automated Update with Ansible

```bash
cd deploy/ansible
ansible-playbook -i inventory.yml playbooks/update.yml
```

The update playbook:

1. Creates a database backup before updating
2. Pulls the latest code or Docker images
3. Rebuilds the application container
4. Restarts services (Caddy handles connection draining)
5. Waits for the health check to pass
6. Rolls back automatically if the health check fails

### Rollback

If an update causes issues:

```bash
cd /opt/llamenos/deploy/docker

# Roll back to a specific git commit
cd /opt/llamenos
git checkout <previous-commit>
cd deploy/docker
docker compose -f docker-compose.yml -f docker-compose.production.yml build app
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d
```

### Database Migrations

Storage migrations run automatically on application startup. No manual migration steps are required. The application tracks migration versions per namespace and applies any pending migrations at first access.

---

## Optional: Enable Additional Services

### Whisper Transcription (Legacy -- Server-Side)

> **Note**: As of Epic 78, transcription runs client-side in the browser via WASM Whisper. The server-side Whisper container is no longer needed for most deployments. Enable it only if you have a specific need for server-side transcription.

```bash
cd /opt/llamenos/deploy/docker
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile transcription up -d
```

For GPU acceleration (NVIDIA), set `WHISPER_DEVICE=cuda` in `.env`.

### Asterisk PBX

Self-hosted telephony without a cloud provider. Requires SIP trunk configuration.

```bash
# Generate required secrets
ARI_PASSWORD=$(openssl rand -base64 24)
BRIDGE_SECRET=$(openssl rand -base64 24)

# Add to .env
echo "ARI_PASSWORD=$ARI_PASSWORD" >> .env
echo "BRIDGE_SECRET=$BRIDGE_SECRET" >> .env

docker compose -f docker-compose.yml -f docker-compose.production.yml --profile asterisk up -d
```

### Signal Messaging

Enables the Signal messaging channel for text-based communication.

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml --profile signal up -d
```

---

## Next Steps

- **Invite volunteers**: Use the admin panel to generate invite links.
- **Configure shifts**: Set up recurring shift schedules in the admin panel.
- **Set up the Contact Directory**: Import contacts, configure teams, and set up tags for intake routing.
- **Set up backups**: See [`docs/RUNBOOK.md`](RUNBOOK.md) for automated encrypted backup procedures.
- **Review security**: Read [`docs/security/DEPLOYMENT_HARDENING.md`](security/DEPLOYMENT_HARDENING.md) for the full security hardening checklist.
- **Incident response**: Familiarize yourself with the runbook at [`docs/RUNBOOK.md`](RUNBOOK.md) before you need it.
- **Verify builds**: Before deploying updates, verify release integrity with [`docs/REPRODUCIBLE_BUILDS.md`](REPRODUCIBLE_BUILDS.md).
