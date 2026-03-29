import { execFileSync } from 'node:child_process'

/**
 * Kill orphaned Bun server processes spawned by Playwright's webServer config.
 * Without this, if Playwright crashes or is killed mid-run, `bun run src/server/server.ts`
 * processes survive as orphans and leak memory unboundedly.
 */
export default function globalTeardown() {
  if (process.env.PLAYWRIGHT_BASE_URL) return // external server — not ours to kill

  try {
    const result = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf-8' }).trim()

    for (const line of result.split('\n')) {
      if (!line.includes('src/server/server.ts')) continue
      if (!line.includes('bun')) continue

      const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10)
      if (!pid || pid === process.pid) continue

      try {
        // Only kill processes with the test adapter flag
        const env = execFileSync('cat', [`/proc/${pid}/environ`], { encoding: 'latin1' })
        if (env.includes('USE_TEST_ADAPTER=true')) {
          process.kill(pid, 'SIGTERM')
        }
      } catch {
        // Process already gone or /proc not available
      }
    }
  } catch {
    // Best-effort cleanup — don't fail the test run
  }
}
