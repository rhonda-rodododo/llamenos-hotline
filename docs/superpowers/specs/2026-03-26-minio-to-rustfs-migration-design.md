# MinIO → RustFS Migration + Per-Hub Storage Architecture

**Date:** 2026-03-26
**Status:** Completed
**Scope:** Replace MinIO with RustFS, introduce per-hub bucket isolation, admin-configurable retention, SSE-S3 encryption at rest

## Motivation

MinIO's AGPL license is restrictive for a self-hosted crisis response platform. RustFS is an Apache 2.0-licensed, S3-compatible drop-in replacement that's 2.3x faster for small object payloads. While making this infrastructure swap, we take the opportunity to redesign the storage architecture for proper multi-hub tenant isolation and admin-configurable data retention.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage provider | RustFS (>= alpha.83) | Apache 2.0, S3-compatible, SSE-S3 fixed in alpha.83 |
| Tenant isolation | Per-hub buckets | Structural isolation harder to misconfigure than path prefixes |
| Credentials | Single app credential, app-level enforcement | RustFS IAM CLI/API immature; per-hub IAM deferred |
| Lifecycle management | Admin-configurable with platform caps | Standard S3 `PutBucketLifecycleConfiguration` API |
| Encryption at rest | SSE-S3 enabled by default | Defense-in-depth beneath E2EE |
| Hub deletion | Immediate bucket destruction | Users need ability to destroy all traces on command |

## 1. Infrastructure: RustFS Container

### Docker Image

Replace `minio/minio:RELEASE.2025-01-20T14-49-07Z@sha256:...` with `rustfs/rustfs:latest` (pin to specific version >= alpha.83 with SHA digest).

RustFS runs as non-root user `rustfs` (UID 10001). Volume ownership must match.

### Environment Variables

| Old (MinIO) | New (RustFS container) | New (App) |
|-------------|----------------------|-----------|
| `MINIO_ROOT_USER` | `RUSTFS_ACCESS_KEY` | `STORAGE_ACCESS_KEY` |
| `MINIO_ROOT_PASSWORD` | `RUSTFS_SECRET_KEY` | `STORAGE_SECRET_KEY` |
| `MINIO_ENDPOINT` | — | `STORAGE_ENDPOINT` |
| `MINIO_BUCKET` | — | *(removed — buckets are per-hub)* |

App env vars use provider-agnostic `STORAGE_*` naming. Old `MINIO_*` vars checked as fallback with deprecation warning logged at startup.

### Health Check

Container health check changes from `mc ready local` to `curl -f http://127.0.0.1:9000/health`.

App health endpoint (`/api/health`) changes from `HeadBucketCommand` on a single bucket to `fetch('http://{endpoint}/health')` against RustFS's native health endpoint.

### Ports & Networking

Unchanged: 9000 (S3 API), 9001 (console). Internal network only, not exposed externally.

Dev port offsets unchanged: v1 uses 9002/9003.

### Affected Config Files

- `deploy/docker/docker-compose.yml` — container image, env vars, health check, volume ownership
- `deploy/docker/docker-compose.dev.yml` — same changes, dev credentials
- `deploy/docker/docker-compose.production.yml` — logging config stays, image changes
- `deploy/docker/docker-compose.test.yml` — health check dependency
- `deploy/docker/.env.example` — rename vars
- `deploy/docker/.env.dev.defaults` — rename vars, new defaults (`rustfsadmin`)
- `deploy/ansible/roles/llamenos/tasks/main.yml` — remove MinIO init tasks (bucket, IAM, lifecycle)
- `deploy/ansible/roles/llamenos/templates/env.j2` — rename vars
- `deploy/ansible/vars.example.yml` — rename vars
- `deploy/helm/llamenos/values.yaml` — image, credentials keys, health probes
- `deploy/helm/llamenos/templates/statefulset-minio.yaml` → `statefulset-rustfs.yaml` — full rewrite

### Helm-Specific Changes

- `securityContext.fsGroup: 10001` for UID 10001 volume ownership
- Liveness probe: `httpGet /health` on port 9000 (was `/minio/health/live`)
- Readiness probe: `httpGet /health` on port 9000 (was `/minio/health/ready`)

## 2. Per-Hub Bucket Architecture

### Namespace Registry

A central registry defines storage namespaces with default lifecycle configuration:

```typescript
const STORAGE_NAMESPACES = {
  voicemails: { defaultRetentionDays: 365 },
  attachments: { defaultRetentionDays: null }, // no expiry
} satisfies Record<string, { defaultRetentionDays: number | null }>
```

Adding a new namespace (e.g., `recordings`, `exports`) is a single registry entry. Provisioning, lifecycle, and cleanup all derive from this registry automatically.

### Bucket Naming

Each hub gets one bucket per namespace: `{hubId}-{namespace}`

Examples for hub `abc123`:
- `abc123-voicemails`
- `abc123-attachments`

### Bucket Lifecycle

- **Hub creation** → `StorageManager.provisionHub(hubId)` creates all namespace buckets (`CreateBucketCommand`), applies default lifecycle rules (`PutBucketLifecycleConfigurationCommand`), enables SSE-S3 encryption (`PutBucketEncryptionCommand`)
- **Hub deletion** → `StorageManager.destroyHub(hubId)` empties all namespace buckets (`ListObjectsV2Command` + batch `DeleteObjectsCommand`) then deletes them (`DeleteBucketCommand`). Runs after the DB transaction commits (DB is source of truth). If bucket deletion fails, the error is logged with the orphaned bucket names for manual cleanup — the hub is still considered deleted. This ordering ensures we never have a hub row pointing to non-existent buckets.

### Object Key Structure

Keys within buckets remain the same as today, minus the top-level `files/` or `voicemails/` prefix (the bucket itself provides that scoping):

- Attachments bucket: `{uploadId}/chunk-{XXXXXX}`, `{uploadId}/content`, `{uploadId}/envelopes`, `{uploadId}/metadata`
- Voicemails bucket: `{fileId}/content`

## 3. Admin-Configurable Retention

### Database Schema

New table `hub_storage_settings`:

| Column | Type | Description |
|--------|------|-------------|
| `hubId` | TEXT FK → hubs.id | Hub reference |
| `namespace` | TEXT | Storage namespace (e.g., `voicemails`, `attachments`) |
| `retentionDays` | INT NULL | null = keep forever |
| | | UNIQUE(hubId, namespace) |

### Constraints

- Hub admins can set retention per namespace
- Cannot exceed platform default (if platform says 365 days for voicemails, hub can set 30/90/180 but not 500)
- Platform defaults come from `STORAGE_NAMESPACES` registry (changeable via env var or future super-admin UI)

### API

- `PATCH /api/hubs/:hubId/storage-settings` — update retention for a namespace
- `GET /api/hubs/:hubId/storage-settings` — read current settings (merged with platform defaults)

When retention is updated, the API immediately applies the new lifecycle rule to the S3 bucket via `PutBucketLifecycleConfigurationCommand`.

## 4. Encryption at Rest

SSE-S3 (RustFS-managed keys) enabled on all hub buckets at creation time via `PutBucketEncryptionCommand`. This is defense-in-depth beneath the application-level E2EE — RustFS never sees plaintext regardless, but SSE-S3 protects against disk-level access to the RustFS volume.

Requires RustFS >= alpha.83 (SSE bug fixed in [rustfs/rustfs#1397](https://github.com/rustfs/rustfs/issues/1397), PR #1703).

## 5. App Code Changes

### New: `StorageManager` (replaces `blob-storage.ts`)

`src/server/lib/storage-manager.ts` — wraps `S3Client` with hub-aware bucket routing:

```typescript
interface StorageManager {
  // Data operations (hub-scoped)
  put(hubId: string, namespace: string, key: string, body: ...): Promise<void>
  get(hubId: string, namespace: string, key: string): Promise<BlobResult | null>
  delete(hubId: string, namespace: string, key: string): Promise<void>

  // Hub lifecycle
  provisionHub(hubId: string): Promise<void>
  destroyHub(hubId: string): Promise<void>

  // Retention management
  setRetention(hubId: string, namespace: string, days: number | null): Promise<void>

  // Health
  healthy(): Promise<boolean>
}
```

Bucket name resolved internally: `{hubId}-{namespace}`.

Single `S3Client` instance, single credential set. `forcePathStyle: true` remains required.

### Modified: `FilesService`

- Constructor: `FilesService(db, storageManager | null)` (was `BlobStorage | null`)
- All blob methods gain `hubId` parameter: `putChunk(hubId, uploadId, ...)`, `putAssembled(hubId, uploadId, ...)`, etc.
- `resetForTest()` iterates hub namespaces for cleanup

### Modified: `voicemail-storage.ts`

- `storeVoicemailAudio()` threads `hubId` to `files.putAssembled(hubId, ...)` using `'voicemails'` namespace
- Hub context already available from call routing

### Modified: `health.ts`

- Replace `HeadBucketCommand` check with `storageManager.healthy()` (calls RustFS `/health` endpoint)

### Modified: `server.ts`

- `createBlobStorage()` → `createStorageManager()`, same try/catch graceful degradation
- `createServices(db, storageManager, ...)`

### Modified: `types.ts`

- `BlobStorage` interface replaced by `StorageManager` interface
- `Env.R2_BUCKET` reference updated

### Modified: `routes/files.ts`

- File download/share endpoints thread `hubId` (from hub middleware) through to `FilesService` calls

### Modified: `routes/hubs.ts`

- Hub creation calls `storageManager.provisionHub(hubId)` after DB insert
- Hub deletion calls `storageManager.destroyHub(hubId)` after DB transaction

### Modified: `services/settings.ts`

- `createHub()` — after DB insert, calls `storageManager.provisionHub(hubId)`
- `deleteHub()` — after DB transaction, calls `storageManager.destroyHub(hubId)`

### Environment Variable Migration

Old `MINIO_*` env vars checked as fallback with deprecation warning:

```
MINIO_ENDPOINT → STORAGE_ENDPOINT
MINIO_APP_USER / MINIO_ACCESS_KEY → STORAGE_ACCESS_KEY
MINIO_APP_PASSWORD / MINIO_SECRET_KEY → STORAGE_SECRET_KEY
```

## 6. Deployment Changes

### Ansible

- Remove MinIO init tasks (bucket creation, IAM user, lifecycle rules, policy attachment) — app handles all bucket management via S3 API
- Replace with RustFS container setup only
- Credential generation stays in Ansible (random root credentials injected via env)
- Rename vars: `minio_access_key` → `storage_access_key`, etc.

### Init Scripts

`deploy/scripts/init-minio.sh` is deleted. No init container or script needed — `StorageManager.provisionHub()` creates buckets on demand via standard S3 API.

Server startup verifies RustFS connectivity via health check. No bucket pre-creation.

### Migration Script

One-time `scripts/migrate-minio-to-rustfs.ts`:

1. Connect to old MinIO, list all objects in `llamenos-files`
2. For each object, determine hub ownership from `fileRecords` DB table
3. Copy to correct `{hubId}-{namespace}` bucket in RustFS
4. Verify: checksums before and after

## 7. Testing

### Unit Tests

- `StorageManager` — mocked S3 client; verify bucket name resolution, provisioning creates all namespace buckets, destruction iterates and cleans up, SSE-S3 enabled on creation
- `FilesService` — updated to pass `hubId` through blob methods
- `voicemail-storage.test.ts` — mock expects `hubId` + `'voicemails'` namespace

### API Integration Tests

- File upload/download with hub context
- Hub creation provisions storage buckets
- Hub deletion destroys buckets
- Retention update applies lifecycle rule to correct bucket

### E2E Tests

No new E2E tests — UI unchanged. Existing file upload/download flows exercise the new internals.

### Test Infrastructure

`docker-compose.dev.yml` runs RustFS instead of MinIO. Tests hit real RustFS.

## 8. Out of Scope (Future Work)

Tracked in `docs/NEXT_BACKLOG.md` under "Storage & Infrastructure — Future Work":

- **LUKS volume encryption** — dm-crypt/LUKS on host volume for defense-in-depth beneath SSE-S3 + E2EE. Configure via Ansible.
- **Per-hub IAM credentials** — storage-level tenant isolation when RustFS admin API/CLI matures
- **Export-then-destroy on hub deletion** — download dialog with checklist before destructive delete
- **External KMS (SSE-KMS)** — Hashicorp Vault integration for deployments with higher compliance requirements
- **Super-admin UI for platform retention defaults** — currently defined in code registry
