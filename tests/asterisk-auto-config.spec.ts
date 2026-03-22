import { test, expect } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'

interface MockAri {
  port: number
  calls: Array<{ method: string; path: string; body: string }>
  stop: () => Promise<void>
}

// Starts a mock ARI HTTP server on a dynamic port that records all requests
async function startMockAri(): Promise<MockAri> {
  const calls: Array<{ method: string; path: string; body: string }> = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      calls.push({ method: req.method ?? '', path: req.url ?? '', body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    calls,
    stop: () => new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    ),
  }
}

/** Spawns the bridge process with the given env overrides */
function spawnBridge(extraEnv: Record<string, string>): ChildProcess {
  return spawn('bun', ['run', 'src/index.ts'], {
    cwd: `${process.cwd()}/asterisk-bridge`,
    env: { ...process.env, ...extraEnv },
    stdio: 'pipe',
  })
}

/** Polls /health on the given port until the predicate returns true or timeout elapses */
async function pollHealth(
  port: number,
  predicate: (body: Record<string, unknown>) => boolean,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      if (res.ok) {
        const raw: unknown = await res.json()
        if (typeof raw === 'object' && raw !== null) {
          const body = raw as Record<string, unknown>
          if (predicate(body)) return body
        }
      }
    } catch {
      // bridge not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`pollHealth timed out after ${timeoutMs}ms on port ${port}`)
}

/** Kills a child process and waits for it to exit */
async function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve()
      return
    }
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    proc.once('exit', () => {
      clearTimeout(forceKillTimer)
      resolve()
    })
    proc.kill('SIGTERM')
    forceKillTimer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }, 2000)
  })
}

/** Returns a free port by binding to :0 and immediately closing */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

test('auto-configures PJSIP trunk when SIP env vars are present', async () => {
  const mockAri = await startMockAri()
  const bridgePort = await getFreePort()
  const bridge = spawnBridge({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    SIP_PROVIDER: 'sip.example.com',
    SIP_USERNAME: 'testuser',
    SIP_PASSWORD: 'testpass',
    BRIDGE_PORT: String(bridgePort),
  })

  try {
    await pollHealth(bridgePort, (body) => body['sipConfigured'] === true)

    const configCalls = mockAri.calls.filter((c) =>
      c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/')
    )
    const paths = configCalls.map((c) => c.path)

    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/auth/trunk-auth')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/aor/trunk')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/endpoint/trunk')
    expect(paths).toContain('/ari/asterisk/config/dynamic/res_pjsip/registration/trunk-reg')

    const reloadCalls = mockAri.calls.filter((c) =>
      c.method === 'POST' && c.path === '/ari/asterisk/modules/res_pjsip.so'
    )
    expect(reloadCalls.length).toBeGreaterThan(0)
  } finally {
    await killProcess(bridge)
    await mockAri.stop()
  }
})

test('skips PJSIP config when SIP env vars are absent', async () => {
  const mockAri = await startMockAri()
  const bridgePort = await getFreePort()
  const bridge = spawnBridge({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    BRIDGE_PORT: String(bridgePort),
  })

  try {
    await pollHealth(bridgePort, (body) => body['sipConfigSkipped'] === true)

    const configCalls = mockAri.calls.filter((c) =>
      c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/')
    )
    expect(configCalls.length).toBe(0)
  } finally {
    await killProcess(bridge)
    await mockAri.stop()
  }
})

test('PJSIP auto-config is idempotent across restarts', async () => {
  const mockAri = await startMockAri()
  const bridgePort1 = await getFreePort()
  const bridgePort2 = await getFreePort()

  const makeEnv = (bridgePort: number): Record<string, string> => ({
    ARI_URL: `ws://127.0.0.1:${mockAri.port}/ari/events`,
    ARI_REST_URL: `http://127.0.0.1:${mockAri.port}/ari`,
    ARI_USERNAME: 'test',
    ARI_PASSWORD: 'test',
    WORKER_WEBHOOK_URL: 'http://127.0.0.1:9999',
    BRIDGE_SECRET: 'testsecret',
    SIP_PROVIDER: 'sip.example.com',
    SIP_USERNAME: 'testuser',
    SIP_PASSWORD: 'testpass',
    BRIDGE_PORT: String(bridgePort),
  })

  // First run
  const bridge1 = spawnBridge(makeEnv(bridgePort1))
  try {
    await pollHealth(bridgePort1, (body) => body['sipConfigured'] === true)
  } finally {
    await killProcess(bridge1)
  }

  const callsAfterFirst = mockAri.calls.length

  // Second run on a fresh port — must also issue all four ARI PUT calls and a reload without error
  const bridge2 = spawnBridge(makeEnv(bridgePort2))
  try {
    await pollHealth(bridgePort2, (body) => body['sipConfigured'] === true)

    const newCalls = mockAri.calls.slice(callsAfterFirst)
    const newConfigPaths = newCalls
      .filter((c) => c.method === 'PUT' && c.path.startsWith('/ari/asterisk/config/dynamic/'))
      .map((c) => c.path)

    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/auth/trunk-auth')
    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/aor/trunk')
    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/endpoint/trunk')
    expect(newConfigPaths).toContain('/ari/asterisk/config/dynamic/res_pjsip/registration/trunk-reg')

    const newReloadCalls = newCalls.filter((c) =>
      c.method === 'POST' && c.path === '/ari/asterisk/modules/res_pjsip.so'
    )
    expect(newReloadCalls.length).toBeGreaterThan(0)
  } finally {
    await killProcess(bridge2)
    await mockAri.stop()
  }
})
