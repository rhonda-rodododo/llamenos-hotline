# Hetzner Cloud Module — Server, Firewall, SSH Key
#
# Provisions a hardened VPS with cloud-init that:
#   - Creates a non-root deploy user with sudo
#   - Installs SSH key for the deploy user
#   - Disables root SSH and password authentication
#   - Configures basic OS hardening (unattended-upgrades, fail2ban)

# ── SSH Key ──────────────────────────────────────────────────

resource "hcloud_ssh_key" "deploy" {
  name       = "${var.server_name}-deploy"
  public_key = file(var.ssh_public_key_path)
}

# ── Firewall ─────────────────────────────────────────────────

resource "hcloud_firewall" "server" {
  name = "${var.server_name}-fw"

  labels = {
    app     = "llamenos"
    managed = "opentofu"
  }

  # SSH — restricted to admin CIDRs (set via admin_ssh_cidrs variable)
  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ssh_cidrs
  }

  # HTTP — required for ACME certificate challenges
  rule {
    description = "HTTP"
    direction   = "in"
    protocol    = "tcp"
    port        = "80"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  # HTTPS — application traffic
  rule {
    description = "HTTPS"
    direction   = "in"
    protocol    = "tcp"
    port        = "443"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  # ICMP — allow ping for diagnostics
  rule {
    description = "ICMP"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  # Outbound: allow all (needed for apt updates, Docker pulls, Twilio API, etc.)
  rule {
    description    = "All outbound TCP"
    direction      = "out"
    protocol       = "tcp"
    port           = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description    = "All outbound UDP"
    direction      = "out"
    protocol       = "udp"
    port           = "any"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description    = "Outbound ICMP"
    direction      = "out"
    protocol       = "icmp"
    destination_ips = ["0.0.0.0/0", "::/0"]
  }
}

# ── Cloud-Init ───────────────────────────────────────────────

locals {
  cloud_init = <<-CLOUDINIT
#cloud-config
users:
  - name: deploy
    groups: sudo, docker
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - ${file(var.ssh_public_key_path)}

package_update: true
package_upgrade: true
packages:
  - fail2ban
  - unattended-upgrades
  - ufw
  - curl
  - gnupg
  - ca-certificates

write_files:
  - path: /etc/ssh/sshd_config.d/99-hardening.conf
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      PubkeyAuthentication yes
      X11Forwarding no
      MaxAuthTries 3
      ClientAliveInterval 300
      ClientAliveCountMax 2
    permissions: "0644"

  - path: /etc/fail2ban/jail.local
    content: |
      [sshd]
      enabled = true
      port = 22
      maxretry = 5
      bantime = 3600
      findtime = 600
    permissions: "0644"

runcmd:
  # Enable fail2ban
  - systemctl enable --now fail2ban

  # Enable unattended-upgrades for security patches
  - dpkg-reconfigure -f noninteractive unattended-upgrades

  # Restart SSH to pick up hardened config
  - systemctl restart sshd

  # Disable root account login (SSH key already set for deploy user)
  - passwd -l root
CLOUDINIT
}

# ── Server ───────────────────────────────────────────────────

resource "hcloud_server" "main" {
  name         = var.server_name
  server_type  = var.server_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  user_data    = local.cloud_init
  firewall_ids = [hcloud_firewall.server.id]
  backups      = var.enable_backups

  labels = {
    app     = "llamenos"
    domain  = var.domain
    managed = "opentofu"
  }

  # Prevent accidental destruction of the server
  lifecycle {
    prevent_destroy = false # Set to true once in production
  }

  # Graceful shutdown before deletion
  shutdown_before_deletion = true
}
