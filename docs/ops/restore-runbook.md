# PostgreSQL Restore Runbook

Emergency procedures for restoring the Llamenos PostgreSQL database from an encrypted backup.

## Who Holds the Age Private Key

The `age` private key used to decrypt backups is held **offline** by the org security officer. Never store it in the repo, in Ansible vars, or on any server. To decrypt a backup during a recovery, the security officer must provide the private key file.

## When to Use This

- Database corruption or accidental data deletion
- Server failure requiring migration to a new host
- Ransomware or security incident requiring rollback
- Pre-scheduled maintenance restore test (`just test-restore-demo`)

---

## Restoration Procedures

### Option A: Automated via Ansible (recommended)

```bash
cd deploy/ansible

# List available backups on the demo server
ansible demo -m shell -a "ls -lh /opt/llamenos/backups/daily/" --ask-vault-pass

# Restore a specific backup (replace path with actual backup file)
just restore-demo s3:llamenos-backups/daily/llamenos-20260101-030000.sql.gz.age
# or for a local backup file on the server:
just restore-demo /opt/llamenos/backups/daily/llamenos-20260101-030000.sql.gz.age
```

The restore playbook will:
1. Stop the `app` container
2. Fetch the backup (local or rclone remote)
3. Decrypt with age (requires `backup_age_private_key_path` var)
4. Restore to PostgreSQL via `docker compose exec`
5. Verify `volunteers` table exists
6. Restart the `app` container

### Option B: Manual restore on the server

```bash
# SSH to the server
ssh -i ~/.ssh/llamenos_demo_deploy deploy@<server-ip>

# Set required env vars
export DATABASE_URL="postgresql://llamenos:<PG_PASSWORD>@localhost:5432/llamenos"
export AGE_PRIVATE_KEY_FILE="/tmp/backup-key.txt"  # provided by security officer

# Copy your age private key to the server (securely)
scp backup-key.txt deploy@<server-ip>:/tmp/backup-key.txt
chmod 600 /tmp/backup-key.txt

# Run the restore script
/opt/llamenos/scripts/restore-postgres.sh /opt/llamenos/backups/daily/llamenos-20260101-030000.sql.gz.age

# Clean up private key after restore
shred -u /tmp/backup-key.txt
```

---

## Verifying Backup Integrity Before Restoring

Run the test restore playbook against the demo instance (non-destructive — uses a separate temporary container):

```bash
cd deploy/ansible
just test-restore-demo
```

This will:
1. Find the latest backup in `/opt/llamenos/backups/daily/`
2. Start a temporary PostgreSQL container
3. Restore the backup into it
4. Verify `volunteers` and `active_calls` tables exist with row counts
5. Tear down the temporary container

---

## Handling Partial or Corrupt Backups

If restoration fails mid-way:

1. The `app` container may be stopped — restart it manually: `docker compose start app`
2. The database may be in a partial state — restore an older backup if available
3. Check the backup log: `tail -100 /opt/llamenos/backups/backup.log`
4. If the latest backup is corrupt, use the previous day's backup:
   ```bash
   ls -lth /opt/llamenos/backups/daily/ | head -5
   ```

---

## Finding Available Backups

| Storage | How to list |
|---------|-------------|
| Local (on server) | `ls -lh /opt/llamenos/backups/{daily,weekly,monthly}/` |
| Backblaze B2 | `rclone ls b2:llamenos-backups/` |
| S3-compatible | `rclone ls s3:llamenos-backups/` |

---

## After Restore: Required Steps

1. Verify the app is healthy: `curl https://demo.llamenos-hotline.com/api/health`
2. Clear any browser sessions (admins may need to re-authenticate)
3. Verify volunteer accounts are intact in the admin UI
4. Check audit log for any data discrepancy
5. Document the incident: what was restored, from which backup, and why

---

## Monthly Restore Testing

The `just test-restore-demo` command should be run monthly to verify backup integrity. Add this to the team's ops calendar.

See also: `deploy/ansible/playbooks/test-restore.yml`
