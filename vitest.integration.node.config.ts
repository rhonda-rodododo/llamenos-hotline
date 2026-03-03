import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'node-integration',
    include: ['tests/integration/node/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    // These tests need a real PostgreSQL instance.
    // Set DATABASE_URL env var before running.
    // For MinIO/blob tests, also set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY.
  },
  resolve: {
    alias: [
      { find: /^@worker\/(.*)/, replacement: path.resolve(__dirname, 'apps/worker/$1') },
      { find: /^@shared\/(.*)/, replacement: path.resolve(__dirname, 'packages/shared/$1') },
      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, 'src/client/$1') },
    ],
  },
})
