import { execFileSync } from 'node:child_process'

/**
 * Patterns for processes spawned by Playwright tests that must be cleaned up.
 * Each entry: [process signature to match, env var that proves it's ours (or null to kill unconditionally)].
 */
const ORPHAN_PATTERNS: Array<{ match: string; envGuard: string | null }> = [
  // App server spawned by Playwright webServer config
  { match: 'src/server/server.ts', envGuard: 'USE_TEST_ADAPTER=true' },
  // Asterisk bridge spawned by asterisk-auto-config.spec.ts
  { match: 'asterisk-bridge/src/index.ts', envGuard: null },
  // Bridge spawned via `bun run src/index.ts` from asterisk-bridge/
  { match: 'asterisk-bridge', envGuard: null },
]

/**
 * Kill orphaned Bun processes spawned by Playwright tests.
 * Without this, if Playwright crashes or is killed mid-run, spawned processes
 * survive as orphans and leak memory unboundedly (bridge processes have hit 30GB+).
 */
export default function globalTeardown() {
  if (process.env.PLAYWRIGHT_BASE_URL) return // external server — not ours to kill

  const killed = new Set<number>()

  try {
    const result = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf-8' }).trim()

    for (const line of result.split('\n')) {
      if (!line.includes('bun')) continue

      for (const pattern of ORPHAN_PATTERNS) {
        if (!line.includes(pattern.match)) continue

        const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10)
        if (!pid || pid === process.pid || killed.has(pid)) continue

        try {
          if (pattern.envGuard) {
            const env = execFileSync('cat', [`/proc/${pid}/environ`], { encoding: 'latin1' })
            if (!env.includes(pattern.envGuard)) continue
          }
          process.kill(pid, 'SIGTERM')
          killed.add(pid)
          console.log(
            `[teardown] Sent SIGTERM to orphaned process ${pid}: ${line.trim().slice(0, 120)}`
          )
        } catch {
          // Process already gone or /proc not available
        }
      }
    }
  } catch {
    // Best-effort cleanup — don't fail the test run
  }

  // Wait 2s then SIGKILL any survivors — bun processes can ignore SIGTERM
  if (killed.size > 0) {
    execFileSync('sleep', ['2'])
    for (const pid of killed) {
      try {
        process.kill(pid, 0) // throws if dead
        process.kill(pid, 'SIGKILL')
        console.log(`[teardown] Sent SIGKILL to stubborn process ${pid}`)
      } catch {
        // Already dead — good
      }
    }
  }
}
