/**
 * RustFS/MinIO admin IAM client — manages per-hub users and bucket-scoped policies.
 *
 * Uses the `rc` CLI (RustFS CLI, MinIO-compatible) as a subprocess for admin
 * operations (user creation, policy management). This avoids reimplementing
 * the MinIO admin API signature scheme.
 *
 * If `rc` is not installed, the client degrades gracefully: `available()` returns
 * false and all mutation methods throw. Callers should check availability before
 * invoking IAM operations.
 */
import { execFile } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface StorageAdminClient {
  /** Whether the rc CLI is available on this system */
  available(): Promise<boolean>
  /** Create a new IAM user with the given credentials */
  createUser(accessKey: string, secretKey: string): Promise<void>
  /** Delete an IAM user (idempotent — ignores already-deleted) */
  deleteUser(accessKey: string): Promise<void>
  /** Create a named IAM policy from a policy document */
  createPolicy(name: string, policy: Record<string, unknown>): Promise<void>
  /** Delete a named IAM policy (idempotent) */
  deletePolicy(name: string): Promise<void>
  /** Attach a policy to a user */
  attachPolicy(policyName: string, userName: string): Promise<void>
}

/**
 * Build a bucket-scoped S3 policy document allowing GetObject, PutObject,
 * DeleteObject, and ListBucket on a set of bucket names.
 */
export function buildBucketPolicy(bucketNames: string[]): Record<string, unknown> {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        Resource: bucketNames.map((b) => `arn:aws:s3:::${b}/*`),
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation'],
        Resource: bucketNames.map((b) => `arn:aws:s3:::${b}`),
      },
    ],
  }
}

export function createStorageAdmin(opts: {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  alias?: string
}): StorageAdminClient {
  const alias = opts.alias || 'llamenos-admin'
  let aliasConfigured = false
  let checkedAvailability: boolean | null = null

  async function ensureAlias(): Promise<void> {
    if (aliasConfigured) return
    await execFileAsync('rc', [
      'alias',
      'set',
      alias,
      opts.endpoint,
      opts.accessKeyId,
      opts.secretAccessKey,
    ])
    aliasConfigured = true
  }

  return {
    async available(): Promise<boolean> {
      if (checkedAvailability !== null) return checkedAvailability
      try {
        await execFileAsync('rc', ['--version'])
        checkedAvailability = true
      } catch {
        checkedAvailability = false
      }
      return checkedAvailability
    },

    async createUser(accessKey: string, secretKey: string): Promise<void> {
      await ensureAlias()
      await execFileAsync('rc', ['admin', 'user', 'add', `${alias}/`, accessKey, secretKey])
    },

    async deleteUser(accessKey: string): Promise<void> {
      await ensureAlias()
      try {
        await execFileAsync('rc', ['admin', 'user', 'remove', `${alias}/`, accessKey])
      } catch {
        // User may already be deleted — idempotent
      }
    },

    async createPolicy(name: string, policy: Record<string, unknown>): Promise<void> {
      await ensureAlias()
      const tmpFile = `/tmp/policy-${name}-${Date.now()}.json`
      await Bun.write(tmpFile, JSON.stringify(policy))
      try {
        await execFileAsync('rc', ['admin', 'policy', 'create', `${alias}/`, name, tmpFile])
      } finally {
        try {
          await unlink(tmpFile)
        } catch {
          // Best-effort cleanup
        }
      }
    },

    async deletePolicy(name: string): Promise<void> {
      await ensureAlias()
      try {
        await execFileAsync('rc', ['admin', 'policy', 'remove', `${alias}/`, name])
      } catch {
        // Policy may already be deleted — idempotent
      }
    },

    async attachPolicy(policyName: string, userName: string): Promise<void> {
      await ensureAlias()
      await execFileAsync('rc', [
        'admin',
        'policy',
        'attach',
        `${alias}/`,
        policyName,
        '--user',
        userName,
      ])
    },
  }
}
