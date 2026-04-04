# Operator Runbook

This runbook provides procedures for common operational tasks, incident response, and troubleshooting for Llamenos self-hosted deployments.

**Audience**: System administrators and operators responsible for maintaining a Llamenos instance.

**Conventions**: Commands assume a Docker Compose deployment in `/opt/llamenos/deploy/docker/`. Adjust paths if your deployment differs. All commands should be run as the `deploy` user unless otherwise noted.

---

## Table of Contents

1. [Secret Rotation](#1-secret-rotation)
2. [TLS Certificate Troubleshooting](#2-tls-certificate-troubleshooting)
3. [Database Operations](#3-database-operations)
4. [Backup and Recovery](#4-backup-and-recovery)
5. [Incident Response](#5-incident-response)
6. [Log Analysis and Monitoring](#6-log-analysis-and-monitoring)
7. [Common Issues and Solutions](#7-common-issues-and-solutions)
8. [Authentik (IdP) Operations](#8-authentik-idp-operations)
9. [Contact Directory Operations](#9-contact-directory-operations)
10. [Scaling Considerations](#10-scaling-considerations)
11. [Emergency Procedures](#11-emergency-procedures)

> **Key Revocation and Rotation**: For cryptographic key compromise, volunteer departure key revocation, device seizure response, and hub key rotation procedures, see the dedicated [Key Revocation Runbook](security/KEY_REVOCATION_RUNBOOK.md).

---

## 1. Secret Rotation

### 1.1 Database Password Rotation

**Frequency**: Quarterly, or immediately after any suspected compromise.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new password
NEW_PG_PASSWORD=$(openssl rand -base64 24)
echo "New PG_PASSWORD: $NEW_PG_PASSWORD"

# 2. Change the password in PostgreSQL
docker compose exec postgres psql -U llamenos -d llamenos -c \
  "ALTER USER llamenos PASSWORD '${NEW_PG_PASSWORD}';"

# 3. Update .env
sed -i "s|^PG_PASSWORD=.*|PG_PASSWORD=${NEW_PG_PASSWORD}|" .env

# 4. Restart the application (not the database)
docker compose restart app

# 5. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
echo "Password rotation complete"
```

### 1.2 HMAC Secret Rotation

**Frequency**: Annually, or immediately after suspected compromise.

**WARNING**: Rotating the HMAC secret invalidates all existing phone and IP hashes. Ban list entries will no longer match incoming callers until the ban list is rebuilt. Audit log IP hashes from before the rotation will not match new hashes.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new secret (must be exactly 64 hex characters)
NEW_HMAC=$(openssl rand -hex 32)

# 2. Update .env
sed -i "s|^HMAC_SECRET=.*|HMAC_SECRET=${NEW_HMAC}|" .env

# 3. Restart the application
docker compose restart app

# 4. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

After rotation, re-add banned phone numbers through the admin UI so they are hashed with the new secret.

### 1.3 RustFS Credentials Rotation

**Frequency**: Annually, or after suspected compromise.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new credentials
NEW_ACCESS_KEY=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)
NEW_SECRET_KEY=$(openssl rand -base64 24)

# 2. Update .env with new credentials
sed -i "s|^STORAGE_ACCESS_KEY=.*|STORAGE_ACCESS_KEY=${NEW_ACCESS_KEY}|" .env
sed -i "s|^STORAGE_SECRET_KEY=.*|STORAGE_SECRET_KEY=${NEW_SECRET_KEY}|" .env

# 3. Restart both RustFS and the app
docker compose restart rustfs app

# 4. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

### 1.4 JWT Secret Rotation

**Frequency**: Annually, or immediately after suspected compromise.

**WARNING**: Rotating the JWT secret invalidates all existing JWT tokens. All users will be logged out and must re-authenticate through Authentik.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new secret (64 hex characters)
NEW_JWT_SECRET=$(openssl rand -hex 32)

# 2. Update .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_JWT_SECRET}|" .env

# 3. Restart the application
docker compose restart app

# 4. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

After rotation, all users must re-authenticate. Revoked tokens in `jwtRevocations` are cleared since the old signing key is no longer valid.

### 1.5 IDP_VALUE_ENCRYPTION_KEY Rotation

**Frequency**: Annually, or when key compromise is suspected.

**WARNING**: This key encrypts sensitive values stored by the IdP integration layer. Rotation is versioned -- increment `IDP_VALUE_KEY_VERSION` alongside the new key. The application supports decrypting values encrypted with previous key versions during a transition period.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new encryption key
NEW_IDP_KEY=$(openssl rand -hex 32)

# 2. Get current version
CURRENT_VERSION=$(grep "^IDP_VALUE_KEY_VERSION=" .env | cut -d= -f2)
NEW_VERSION=$((CURRENT_VERSION + 1))

# 3. Update .env (keep old key as IDP_VALUE_ENCRYPTION_KEY_PREV for transition)
sed -i "s|^IDP_VALUE_ENCRYPTION_KEY=.*|IDP_VALUE_ENCRYPTION_KEY=${NEW_IDP_KEY}|" .env
sed -i "s|^IDP_VALUE_KEY_VERSION=.*|IDP_VALUE_KEY_VERSION=${NEW_VERSION}|" .env

# 4. Restart the application
docker compose restart app

# 5. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

### 1.6 Twilio Credentials Rotation

**Frequency**: Quarterly, or immediately after compromise.

1. Go to the Twilio Console > Account > API Keys.
2. Create a new API key.
3. Update the credentials:

```bash
cd /opt/llamenos/deploy/docker

# Update .env with new values
# TWILIO_AUTH_TOKEN=<new auth token>

docker compose restart app
```

Alternatively, rotate credentials through the admin UI at Settings > Telephony Provider without touching `.env`.

4. Revoke the old API key in the Twilio Console.

### 1.7 Server Nostr Secret Rotation

**Frequency**: Only when compromised, or when deliberately changing the server's Nostr identity.

**WARNING**: Rotating `SERVER_NOSTR_SECRET` changes the server's Nostr keypair. All clients will see a new server pubkey after re-authenticating. Active relay subscriptions will need to be re-established.

```bash
cd /opt/llamenos/deploy/docker

# 1. Generate new secret (must be exactly 64 hex characters)
NEW_NOSTR_SECRET=$(openssl rand -hex 32)

# 2. Update .env
sed -i "s|^SERVER_NOSTR_SECRET=.*|SERVER_NOSTR_SECRET=${NEW_NOSTR_SECRET}|" .env

# 3. Restart the application (relay does not need restart)
docker compose restart app

# 4. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

After rotation:
- All connected clients will automatically reconnect and accept the new server identity
- Historical events signed by the old server key will fail verification (acceptable — ephemeral events are not persisted)

### 1.8 Asterisk / Bridge Secrets Rotation

Only applicable if using the Asterisk profile.

```bash
cd /opt/llamenos/deploy/docker

# Generate new secrets
NEW_ARI_PASSWORD=$(openssl rand -base64 24)
NEW_BRIDGE_SECRET=$(openssl rand -base64 24)

# Update .env
sed -i "s|^ARI_PASSWORD=.*|ARI_PASSWORD=${NEW_ARI_PASSWORD}|" .env
sed -i "s|^BRIDGE_SECRET=.*|BRIDGE_SECRET=${NEW_BRIDGE_SECRET}|" .env

# Update Asterisk ARI config
docker compose exec asterisk sed -i \
  "s|^password=.*|password=${NEW_ARI_PASSWORD}|" /etc/asterisk/ari.conf

# Restart all affected services
docker compose restart asterisk sip-bridge app
```

---

## 2. TLS Certificate Troubleshooting

Caddy handles TLS certificates automatically via Let's Encrypt (or ZeroSSL). Most certificate issues resolve themselves. Intervene only if automatic renewal fails.

### 2.1 Check Certificate Status

```bash
# View Caddy logs for certificate operations
docker compose logs caddy | grep -i "tls\|certificate\|acme"

# Check certificate expiry from outside
echo | openssl s_client -connect hotline.yourorg.org:443 -servername hotline.yourorg.org 2>/dev/null \
  | openssl x509 -noout -dates
```

### 2.2 Common Certificate Issues

#### DNS not pointing to server

```bash
# Verify DNS resolution
dig +short hotline.yourorg.org

# Should return your server's IP address
# If not, update your DNS records and wait for propagation
```

#### Port 80 blocked (ACME HTTP-01 challenge)

Let's Encrypt requires port 80 to be accessible for HTTP-01 challenges.

```bash
# Verify port 80 is open in the firewall
sudo ufw status | grep 80

# Verify Caddy is listening
docker compose port caddy 80

# Test from outside
curl -I http://hotline.yourorg.org
```

#### Rate limit exceeded

Let's Encrypt rate limits: 5 duplicate certificates per week, 50 certificates per domain per week. If you hit this, wait or use the staging endpoint temporarily.

```bash
# Switch to staging (untrusted certs, no rate limits)
# Add to your Caddyfile, inside the site block:
#   tls {
#     ca https://acme-staging-v02.api.letsencrypt.org/directory
#   }

# Then restart Caddy
docker compose restart caddy
```

Remove the staging directive once rate limits reset (1 week).

#### Force certificate renewal

```bash
# Remove Caddy's stored certificates
docker compose exec caddy caddy untrust
docker compose down caddy
docker volume rm llamenos_caddy-data
docker compose up -d caddy

# Caddy will obtain new certificates on startup
docker compose logs -f caddy
```

### 2.3 Custom Certificates

If you manage certificates externally (e.g., Cloudflare Origin CA):

Edit the `Caddyfile` to specify your certificate and key:

```
hotline.yourorg.org {
    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem
    # ... rest of config
}
```

Mount the certificate files as a Docker volume in `docker-compose.yml`.

---

## 3. Database Operations

### 3.1 Connect to PostgreSQL

```bash
# Interactive psql session
docker compose exec postgres psql -U llamenos -d llamenos

# Run a single query
docker compose exec postgres psql -U llamenos -d llamenos -c "SELECT count(*) FROM storage;"
```

### 3.2 Check Database Size

```bash
docker compose exec postgres psql -U llamenos -d llamenos -c "
  SELECT pg_size_pretty(pg_database_size('llamenos')) AS db_size;
"
```

### 3.3 Check Active Connections

```bash
docker compose exec postgres psql -U llamenos -d llamenos -c "
  SELECT count(*), state
  FROM pg_stat_activity
  WHERE datname = 'llamenos'
  GROUP BY state;
"
```

### 3.4 Vacuum and Analyze

PostgreSQL runs autovacuum by default. If you notice performance degradation:

```bash
docker compose exec postgres psql -U llamenos -d llamenos -c "VACUUM ANALYZE;"
```

---

## 4. Backup and Recovery

### 4.1 Manual Database Backup

```bash
cd /opt/llamenos/deploy/docker

# Create backup directory
mkdir -p /opt/llamenos/backups

# Dump, compress, and encrypt
docker compose exec -T postgres pg_dump -U llamenos llamenos \
  | gzip \
  | age -r "age1your-public-key-here" \
  > /opt/llamenos/backups/llamenos_$(date +%Y%m%d_%H%M%S).sql.gz.age

echo "Backup complete: $(ls -lh /opt/llamenos/backups/ | tail -1)"
```

**NOTE**: You need the `age` encryption tool. Install with: `apt install age`. Generate a keypair with: `age-keygen -o /root/backup-key.txt`. The public key is used for encryption; the private key (stored securely offline) is needed for decryption.

### 4.2 Automated Backup Script

Create `/opt/llamenos/backup.sh`:

```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/opt/llamenos/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30
AGE_RECIPIENT="age1your-public-key-here"  # Replace with your age public key

mkdir -p "$BACKUP_DIR"

# Database backup (compressed + encrypted)
docker compose -f /opt/llamenos/deploy/docker/docker-compose.yml \
  exec -T postgres pg_dump -U llamenos llamenos \
  | gzip \
  | age -r "$AGE_RECIPIENT" \
  > "$BACKUP_DIR/llamenos_${DATE}.sql.gz.age"

# Rotate old backups
find "$BACKUP_DIR" -name "*.age" -mtime +${RETENTION_DAYS} -delete

# Optional: upload to off-site storage
# rclone copy "$BACKUP_DIR/llamenos_${DATE}.sql.gz.age" remote:llamenos-backups/

echo "[$(date)] Backup complete: llamenos_${DATE}.sql.gz.age"
```

```bash
chmod 700 /opt/llamenos/backup.sh

# Add to crontab (runs daily at 03:00 UTC)
(crontab -l 2>/dev/null; echo "0 3 * * * /opt/llamenos/backup.sh >> /var/log/llamenos-backup.log 2>&1") | crontab -
```

### 4.3 Verify Backup Integrity

Periodically verify that backups can be decrypted and restored:

```bash
# Decrypt and inspect (do NOT restore to production)
LATEST=$(ls -t /opt/llamenos/backups/*.age | head -1)
age -d -i /root/backup-key.txt "$LATEST" | gunzip | head -50
```

### 4.4 Restore from Backup

**WARNING**: This replaces all data in the database. All changes since the backup will be lost.

```bash
cd /opt/llamenos/deploy/docker

# 1. Stop the application (keep database running)
docker compose stop app

# 2. Decrypt the backup
age -d -i /root/backup-key.txt /opt/llamenos/backups/llamenos_20260223_030000.sql.gz.age \
  | gunzip > /tmp/restore.sql

# 3. Drop and recreate the database
docker compose exec postgres psql -U llamenos -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='llamenos';
"
docker compose exec postgres psql -U llamenos -d postgres -c "DROP DATABASE llamenos;"
docker compose exec postgres psql -U llamenos -d postgres -c "CREATE DATABASE llamenos OWNER llamenos;"

# 4. Restore
docker compose exec -T postgres psql -U llamenos -d llamenos < /tmp/restore.sql

# 5. Clean up the unencrypted dump
rm -f /tmp/restore.sql

# 6. Restart the application
docker compose start app

# 7. Verify
docker compose exec app curl -sf http://localhost:3000/api/health
```

### 4.5 Nostr Relay (strfry) Backup

Back up the strfry LMDB data directory:

```bash
# Back up the strfry-db Docker volume
docker run --rm -v llamenos_nostr-data:/data -v /opt/llamenos/backups:/backup \
  alpine tar czf /backup/strfry-$(date +%Y%m%d).tar.gz -C /data .
```

**Note**: If all events are ephemeral (kind 20001), the relay database is small and contains only relay state — not user data. Backup is recommended but not critical.

### 4.6 RustFS Blob Backup

RustFS stores uploaded files (encrypted reports, IVR audio, voicemail recordings). Back it up separately using any S3-compatible client:

```bash
# Using rclone (recommended for large datasets)
rclone sync rustfs:hub-files /opt/llamenos/backups/rustfs/

# Or use the AWS CLI with S3-compatible endpoint
aws --endpoint-url http://localhost:9002 s3 sync s3://hub-files /opt/llamenos/backups/rustfs/

# Or use rclone for off-site backup
# rclone sync rustfs:hub-files remote:llamenos-rustfs-backup/
```

### 4.7 Authentik Database Backup

Authentik uses its own PostgreSQL database. Include it in your backup procedure:

```bash
cd /opt/llamenos/deploy/docker

# Dump the Authentik database
docker compose exec -T authentik-postgresql pg_dump -U authentik authentik \
  | gzip \
  | age -r "age1your-public-key-here" \
  > /opt/llamenos/backups/authentik_$(date +%Y%m%d_%H%M%S).sql.gz.age

echo "Authentik DB backup complete"
```

**Note**: Authentik also uses Redis for caching and session state. Redis data is ephemeral and will be rebuilt on restart -- it does not need to be backed up. After restoring the Authentik database, restart the Authentik services and Redis will repopulate automatically.

---

## 5. Incident Response

### 5.1 Incident Response Checklist

When a security incident is suspected, follow this checklist in order:

1. **Assess**: Determine the scope and severity.
   - What was compromised? (server, account, credentials, code)
   - When did the compromise occur? (check audit logs)
   - Is the attacker still active? (check active sessions, unusual processes)

2. **Contain**: Limit the damage.
   - Revoke compromised credentials immediately.
   - If the server is compromised, take it offline if safe to do so.
   - Block attacker IP addresses in the firewall.

3. **Investigate**: Gather evidence.
   - Export application audit logs from the admin panel.
   - Preserve Docker container logs: `docker compose logs > /tmp/incident-logs-$(date +%s).txt`
   - Preserve system logs: `journalctl --since "2 days ago" > /tmp/system-logs.txt`
   - Check fail2ban logs: `sudo fail2ban-client status sshd`

4. **Remediate**: Fix the vulnerability.
   - Rotate all relevant secrets (see [Section 1](#1-secret-rotation)).
   - Apply any needed patches.
   - Rebuild containers from known-good code if supply chain is suspected.

5. **Recover**: Restore service.
   - Restart services after remediation.
   - Verify health checks pass.
   - Monitor closely for 48 hours.

6. **Communicate**: Notify affected parties.
   - Notify your organization's leadership.
   - If volunteer or caller data may have been exposed, follow your organization's breach notification policy.
   - GDPR requires breach notification within 72 hours if personal data is affected.

### 5.2 Volunteer Account Compromise

> **See also**: The [Key Revocation Runbook](security/KEY_REVOCATION_RUNBOOK.md) covers volunteer departure key revocation (friendly and hostile), device seizure response, and hub key rotation procedures.

A volunteer's device or credentials have been compromised.

```bash
# 1. Deactivate the volunteer immediately via the admin UI
#    This revokes ALL active sessions automatically.
#    Navigate to: Volunteers > [volunteer] > Deactivate

# 2. If admin UI is not accessible, deactivate via the database:
docker compose exec postgres psql -U llamenos -d llamenos -c "
  UPDATE storage
  SET value = jsonb_set(value::jsonb, '{active}', 'false')
  WHERE namespace = 'identity'
    AND key LIKE 'volunteer:%'
    AND value::jsonb->>'pubkey' = '<compromised_pubkey>';
"

# 3. Restart the app to clear any cached sessions
docker compose restart app
```

**Note on E2EE protection**: The compromised volunteer's V2 notes (forward-secret encryption) remain protected. Each note uses a unique ephemeral key -- compromising the identity key does not reveal past note content. However, any notes the volunteer creates while the attacker has access may be readable by the attacker.

After the incident:
- Generate a new invite for the volunteer to re-onboard with a fresh keypair.
- Review the audit log for any unauthorized actions during the compromise window.

### 5.3 Admin Account Compromise

> **See also**: The [Key Revocation Runbook](security/KEY_REVOCATION_RUNBOOK.md) covers the full cryptographic response procedure for admin key compromise, including hub key rotation, envelope re-wrapping, GDPR assessment, and maximum response timeframes.

This is the most severe account compromise scenario.

1. **Immediately** take the application offline:
   ```bash
   docker compose stop app
   ```

2. Generate a new admin account:
   - Create a new admin account via the setup wizard or Authentik admin panel on a trusted machine.

3. Update the server configuration:
   ```bash
   # Update ADMIN_PUBKEY in .env with the new public key
   sed -i "s|^ADMIN_PUBKEY=.*|ADMIN_PUBKEY=<new_pubkey>|" .env
   ```

4. Rotate all secrets (database, HMAC, JWT, RustFS, telephony, IDP_VALUE_ENCRYPTION_KEY).

5. Restart the application:
   ```bash
   docker compose up -d
   ```

6. Review the audit log for unauthorized actions.

7. Re-wrap note encryption keys. Admin-wrapped envelopes created with the old admin key are no longer decryptable by the new admin key. Volunteers must be online to re-wrap their notes for the new admin.

### 5.4 Server Compromise

The VPS itself has been compromised (SSH breach, container escape, provider-level access).

**Key insight**: E2EE notes are safe. The server never has plaintext note content. The attacker can access metadata (who wrote what, when, call IDs) but not note content.

1. **Provision a new server** (do not attempt to clean the compromised server).

2. **Restore from backup** on the new server following the [Quick Start Guide](QUICKSTART.md).

3. **Rotate ALL secrets**:
   - Database password
   - HMAC secret
   - RustFS credentials
   - Twilio/telephony credentials
   - Asterisk credentials (if applicable)
   - SSH keys (generate new key pairs for the new server)

4. **Update DNS** to point to the new server.

5. **Notify all volunteers** to re-authenticate. Their client-side keys are not affected by a server compromise.

6. **Preserve the compromised server** for forensic analysis if legally required. Do not destroy evidence.

---

## 6. Log Analysis and Monitoring

### 6.1 View Application Logs

```bash
cd /opt/llamenos/deploy/docker

# All services, last 100 lines
docker compose logs --tail 100

# Follow specific service logs
docker compose logs -f app
docker compose logs -f caddy
docker compose logs -f postgres

# Filter by time
docker compose logs --since "1h" app
docker compose logs --since "2026-02-23T10:00:00" app
```

### 6.2 Application Audit Log

The application maintains its own audit log accessible through the admin UI. It records:

- Login/logout events
- Volunteer account changes (create, deactivate, delete)
- Settings modifications
- Call events (answered, missed, voicemail)
- Note creation and edits
- Telephony provider configuration changes

Export audit logs via the admin panel or query the database directly:

```bash
docker compose exec postgres psql -U llamenos -d llamenos -c "
  SELECT key, value->>'action' AS action, value->>'timestamp' AS ts
  FROM storage
  WHERE namespace = 'records' AND key LIKE 'audit:%'
  ORDER BY key DESC
  LIMIT 20;
"
```

### 6.3 System Monitoring

#### Disk usage

```bash
# Docker volumes
docker system df -v

# PostgreSQL data directory
docker compose exec postgres du -sh /var/lib/postgresql/data/

# Overall disk
df -h /var/lib/docker
```

#### Memory and CPU

```bash
# Per-container resource usage
docker stats --no-stream

# System-wide
free -h
top -bn1 | head -20
```

#### Container health

```bash
# Health check status for all containers
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"
```

### 6.4 Log Rotation

Docker log rotation is configured in the daemon settings (`/etc/docker/daemon.json`):

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

This limits each container to 30 MB of logs (3 files x 10 MB). Adjust if you need more history.

### 6.5 Nostr Relay Monitoring

Monitor the Nostr relay (core service):

```bash
# Check relay health
docker compose exec strfry curl -sf http://localhost:7777

# View relay logs
docker compose logs strfry --tail 50

# Check LMDB database size
docker compose exec strfry du -sh /app/strfry-db/

# Check relay container resource usage
docker stats strfry --no-stream
```

For detailed relay monitoring and troubleshooting, see [`docs/RELAY_OPERATIONS.md`](RELAY_OPERATIONS.md).

### 6.6 External Monitoring

Set up an external uptime monitor to alert on downtime:

- **Endpoint**: `https://hotline.yourorg.org/api/health`
- **Expected response**: `200 OK` with body `{"status":"ok"}`
- **Check interval**: 60 seconds
- **Alert threshold**: 2 consecutive failures

Recommended services: UptimeRobot (free tier), Healthchecks.io (free tier), or Uptime Kuma (self-hosted).

---

## 7. Common Issues and Solutions

### 7.1 Application Won't Start

**Symptom**: `docker compose up` fails or the app container keeps restarting.

```bash
# Check container logs
docker compose logs app --tail 50

# Check if database is ready
docker compose exec postgres pg_isready -U llamenos
```

**Common causes**:

| Error | Cause | Solution |
|-------|-------|----------|
| `PG_PASSWORD is required` | Missing `.env` variable | Set `PG_PASSWORD` in `.env` |
| `ADMIN_PUBKEY is required` | Missing admin key | Complete setup wizard to generate admin keypair |
| `HMAC_SECRET is required` | Missing HMAC secret | Generate with `openssl rand -hex 32` |
| `JWT_SECRET is required` | Missing JWT secret | Generate with `openssl rand -hex 32` |
| `Connection refused` (postgres) | Database not ready | Wait for postgres health check; check `docker compose ps` |
| `ECONNREFUSED` (rustfs) | RustFS not ready | Wait for RustFS health check; verify UID 10001 owns volume |
| `Authentik unhealthy` | IdP not ready | Check `docker compose logs authentik-server`; verify Redis is running |
| `out of memory` | Insufficient RAM | Increase VPS RAM or reduce `PG_POOL_SIZE` |

### 7.2 Caddy Returns 502 Bad Gateway

The reverse proxy cannot reach the application.

```bash
# Verify the app container is running and healthy
docker compose ps app

# Check if the app is listening
docker compose exec app curl -sf http://localhost:3000/api/health

# Check Caddy logs
docker compose logs caddy --tail 20
```

**Likely causes**: The app container is still starting (wait for health check), or it crashed (check app logs).

### 7.3 Nostr Relay Connection Fails

**Symptom**: Real-time updates (call notifications, presence indicators) do not work.

```bash
# Check if the relay container is running
docker compose ps strfry

# Check the relay health
docker compose exec strfry curl -sf http://localhost:7777

# Test the WebSocket proxy endpoint from outside
curl -sI https://hotline.yourorg.org/nostr
# Should return 426 Upgrade Required (not a proper WS handshake, but confirms routing)

# Check browser console for relay errors
# Common: "Failed to connect to wss://hotline.yourorg.org/nostr"
```

**Common causes**:

| Symptom | Cause | Solution |
|---------|-------|----------|
| Relay container not running | Container stopped or failed | `docker compose up -d strfry` |
| 502 on `/nostr` | Caddy can't reach strfry | Check `docker compose logs caddy` for upstream errors |
| Auth failures in browser console | `SERVER_NOSTR_SECRET` missing or changed | Verify `.env` has `SERVER_NOSTR_SECRET`; restart app if changed |
| Events not delivered | NIP-42 auth failing | Check relay logs; verify client pubkey is allowed |
| Cloudflare 524 timeout | CF drops idle WebSocket after 100s | Enable WebSocket in Cloudflare dashboard; app sends periodic pings |

### 7.4 Database Disk Full

```bash
# Check disk usage
docker compose exec postgres du -sh /var/lib/postgresql/data/

# Check for bloat
docker compose exec postgres psql -U llamenos -d llamenos -c "
  SELECT schemaname, tablename,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename))
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;
"

# Run vacuum to reclaim space
docker compose exec postgres psql -U llamenos -d llamenos -c "VACUUM FULL;"
```

If the volume is genuinely full, resize the Docker volume or the underlying disk at your VPS provider.

### 7.5 Health Check Failures

```bash
# Check what the health endpoint returns
docker compose exec app curl -v http://localhost:3000/api/health

# If database connection is failing
docker compose exec postgres pg_isready -U llamenos

# If RustFS is failing
curl -sf http://localhost:9002/health

# If Authentik is failing
curl -sf http://localhost:9000/idp/-/health/ready/
```

### 7.8 Authentication Failures

**Symptom**: Users cannot log in, or get 401/403 errors after login.

```bash
# Check Authentik IdP health
curl -sf https://hotline.yourorg.org/idp/-/health/ready/

# Check Authentik logs
docker compose logs authentik-server --tail 50

# Check app JWT verification logs
docker compose logs app --tail 50 | grep -i "jwt\|auth\|token"
```

**Common causes**:

| Symptom | Cause | Solution |
|---------|-------|----------|
| Login redirects fail | Authentik unhealthy | Restart `authentik-server` and `authentik-worker`; check Redis |
| 401 after login | JWT expired or invalid | Check clock sync (NTP); verify `JWT_SECRET` matches between app and IdP |
| 403 on API calls | Token refresh failed | Check `jwtRevocations` table; user may need to re-authenticate |
| Passkey not working | WebAuthn RP mismatch | Verify `WEBAUTHN_RP_ID` matches your domain in Authentik config |

### 7.6 Docker Image Build Fails

```bash
# Clean Docker build cache
docker builder prune -f

# Rebuild without cache
docker compose build --no-cache app

# Check available disk space (builds need ~2 GB temporary space)
df -h /var/lib/docker
```

### 7.7 fail2ban Blocking Legitimate Users

```bash
# Check banned IPs
sudo fail2ban-client status sshd

# Unban a specific IP
sudo fail2ban-client set sshd unbanip 203.0.113.50

# Check fail2ban log
sudo tail -50 /var/log/fail2ban.log
```

---

## 8. Authentik (IdP) Operations

### 8.1 Health Monitoring

```bash
# Check Authentik readiness
curl -sf https://hotline.yourorg.org/idp/-/health/ready/

# Check Authentik liveness
curl -sf https://hotline.yourorg.org/idp/-/health/live/

# View Authentik server logs
docker compose logs authentik-server --tail 100

# View Authentik worker logs (background tasks)
docker compose logs authentik-worker --tail 100
```

### 8.2 Authentik Backup

Authentik stores data in its own PostgreSQL database and uses Redis for caching:

```bash
cd /opt/llamenos/deploy/docker

# Database backup (include in your daily backup script)
docker compose exec -T authentik-postgresql pg_dump -U authentik authentik \
  | gzip \
  | age -r "age1your-public-key-here" \
  > /opt/llamenos/backups/authentik_$(date +%Y%m%d_%H%M%S).sql.gz.age
```

**Redis does not need backup** -- it contains only cache and session data that rebuilds on restart.

### 8.3 User Management

User accounts are managed through the Authentik admin interface or via the Llamenos admin panel:

- **Authentik admin**: `https://hotline.yourorg.org/idp/if/admin/` -- full IdP administration
- **Llamenos admin panel**: Volunteers > manage individual accounts

To deactivate a user at the IdP level (prevents all authentication):

```bash
# Via Authentik API
curl -X PATCH https://hotline.yourorg.org/idp/api/v3/core/users/<user-id>/ \
  -H "Authorization: Bearer ${AUTHENTIK_BOOTSTRAP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"is_active": false}'
```

### 8.4 Blueprint Updates

Authentik uses blueprints for declarative configuration. When updating Llamenos, new blueprints may be included:

```bash
# Apply updated blueprints
docker compose exec authentik-server ak apply_blueprint /blueprints/llamenos/

# Check blueprint status
docker compose exec authentik-server ak list_blueprints
```

## 9. Contact Directory Operations

### 9.1 Bulk Import

Import contacts from CSV via the admin panel or API:

```bash
# API bulk import (JSON array of contacts)
curl -X POST https://hotline.yourorg.org/api/contacts/bulk \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d @contacts.json
```

### 9.2 Bulk Export

Export all contacts (encrypted fields are exported in encrypted form):

```bash
curl -s https://hotline.yourorg.org/api/contacts/export \
  -H "Authorization: Bearer ${TOKEN}" \
  > contacts-export.json
```

### 9.3 Tag Management

Tags are used for intake routing and contact categorization. Manage via the admin panel at Contacts > Tags, or via API:

```bash
# List all tags
curl -s https://hotline.yourorg.org/api/contacts/tags \
  -H "Authorization: Bearer ${TOKEN}"
```

## 10. Scaling Considerations

### 8.1 Single-Server Limits

The Docker Compose deployment on a single VPS is designed for small organizations (1-10 volunteers). Expected limits:

| Resource | Capacity |
|----------|----------|
| Concurrent calls | ~50 (limited by telephony provider, not server) |
| Concurrent Nostr relay subscriptions | ~500 (strfry handles thousands; practical limit is app-side) |
| Database storage | Limited by disk size |
| API requests | ~1000/s (Hono on Node.js) |

### 8.2 Vertical Scaling

The simplest scaling approach: upgrade your VPS to a larger instance.

- **More RAM**: Increase `PG_POOL_SIZE` in `.env` (default: 10).
- **More CPU**: Benefits the app container and any transcription workloads.
- **More disk**: Resize the VPS disk or Docker volume.

### 8.3 Horizontal Scaling (Kubernetes)

For larger deployments (10-100+ volunteers), migrate to the Kubernetes deployment using the Helm chart at `deploy/helm/llamenos/`. The Helm chart supports:

- Multiple app replicas behind an Ingress controller
- External PostgreSQL (e.g., AWS RDS, Cloud SQL) for database HA
- NetworkPolicy for pod isolation
- Pod autoscaling

See `docs/security/DEPLOYMENT_HARDENING.md` for the full Kubernetes deployment guide.

### 8.4 Database Performance

If you observe slow queries:

```bash
# Enable slow query logging
docker compose exec postgres psql -U llamenos -d llamenos -c "
  ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries >1s
  SELECT pg_reload_conf();
"

# Check for missing indexes
docker compose exec postgres psql -U llamenos -d llamenos -c "
  SELECT schemaname, tablename, seq_scan, idx_scan
  FROM pg_stat_user_tables
  WHERE seq_scan > idx_scan
  ORDER BY seq_scan DESC;
"
```

---

## 11. Emergency Procedures

### 9.1 Emergency Shutdown

If you need to take the hotline offline immediately:

```bash
cd /opt/llamenos/deploy/docker

# Stop all services
docker compose down

# Verify nothing is running
docker compose ps
```

To bring it back:

```bash
docker compose up -d
# Wait for health checks
docker compose logs -f app
```

### 9.2 Data Breach Response

If you suspect unauthorized access to data:

1. **Do NOT shut down the server immediately** -- preserve evidence.

2. **Capture forensic data**:
   ```bash
   # Capture running processes
   ps auxww > /tmp/forensics-ps-$(date +%s).txt

   # Capture network connections
   ss -tulpn > /tmp/forensics-netstat-$(date +%s).txt

   # Capture Docker state
   docker compose ps > /tmp/forensics-docker-$(date +%s).txt
   docker compose logs > /tmp/forensics-logs-$(date +%s).txt

   # Capture login history
   last > /tmp/forensics-last-$(date +%s).txt
   lastb > /tmp/forensics-lastb-$(date +%s).txt
   ```

3. **Assess the impact**:
   - **E2EE notes are NOT exposed** even in a full server breach. The server never has plaintext note content.
   - **Metadata IS exposed**: call timestamps, volunteer pubkeys, caller phone hashes, audit log entries.
   - **Telephony credentials** stored in `.env` or the database may be exposed.
   - **Session tokens** in the database may be exposed (attacker could impersonate users until tokens expire).

4. **Contain**:
   ```bash
   # Revoke all active sessions by restarting with new HMAC secret
   NEW_HMAC=$(openssl rand -hex 32)
   sed -i "s|^HMAC_SECRET=.*|HMAC_SECRET=${NEW_HMAC}|" .env
   docker compose restart app
   ```

5. **GDPR notification** (if applicable): You have 72 hours to notify the supervisory authority if personal data was breached. Prepare a report covering:
   - Nature of the breach
   - Categories and approximate number of data subjects affected
   - Likely consequences
   - Measures taken to address the breach

### 9.3 Ransomware Response

If the server is encrypted by ransomware:

1. **Do NOT pay the ransom.**
2. Isolate the server (disable networking at the VPS provider dashboard).
3. Provision a new server following the [Quick Start Guide](QUICKSTART.md).
4. Restore from the most recent encrypted backup (stored off-site).
5. Rotate all secrets.
6. Report to law enforcement if appropriate for your jurisdiction.

### 9.4 Complete Infrastructure Rebuild

If you need to rebuild from scratch (server unrecoverable, no trust in existing infrastructure):

```bash
# On a new, clean server:

# 1. Follow the Quick Start Guide sections 1-4
# 2. Restore PostgreSQL database from off-site backup
# 3. Restore Authentik database from off-site backup
# 4. Restore RustFS blobs from off-site backup
# 5. Restore strfry relay data from off-site backup
# 6. Create new admin account via setup wizard
# 7. Rotate ALL secrets
# 8. Update DNS to point to new server
# 9. Notify volunteers to re-authenticate
```

The admin will need to re-wrap note encryption envelopes with the new admin keypair. This requires volunteers to be online.

### 9.5 Telephony Provider Outage

If your telephony provider is down (Twilio outage, etc.):

1. Calls will fail to route. The application itself continues to function for messaging and notes.
2. Check provider status pages (e.g., status.twilio.com).
3. If the outage is extended, consider switching providers:
   - Go to Settings > Telephony Provider in the admin UI.
   - Select an alternative provider and enter its credentials.
   - Save and test.
4. Update the phone number's webhook URLs at the new provider.

---

## Appendix: Maintenance Schedule

| Task | Frequency | Procedure |
|------|-----------|-----------|
| Verify backups | Weekly | [Section 4.3](#43-verify-backup-integrity) |
| Review audit logs | Weekly | Admin UI > Audit Log |
| Check disk usage | Weekly | [Section 6.3](#63-system-monitoring) |
| OS security updates | Automatic | `unattended-upgrades` |
| Docker image updates | Monthly | `docker compose pull && docker compose up -d` |
| Secret rotation | Quarterly | [Section 1](#1-secret-rotation) |
| TLS certificate | Automatic | Caddy auto-renewal |
| Database vacuum | Monthly | [Section 3.4](#34-vacuum-and-analyze) |
| Dependency audit | Monthly | `bun audit` against latest source |
| Backup retention cleanup | Automatic | Cron script (30-day default) |
| Full restore test | Quarterly | Restore backup to staging environment |
| Penetration test | Annually | Engage external security firm |
