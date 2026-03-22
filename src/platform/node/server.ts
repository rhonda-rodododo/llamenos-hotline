import path from 'node:path'
/**
 * Node.js server entry point.
 * Runs the Hono app with @hono/node-server, serving static files.
 *
 * Real-time events use the Nostr relay (strfry) — no direct WebSocket
 * handling needed in the app server. Clients connect to the relay via
 * the Caddy reverse proxy at /nostr.
 */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { Hono } from 'hono'
import { initDb } from '../../server/db'
import { createServices } from '../../server/services'
import { closeNostrPublisher } from '../../server/lib/adapters'
import { errorHandler } from '../../server/middleware/error'
import { servicesMiddleware } from '../../server/middleware/services'
import { loadEnv } from './env'

async function main() {
  console.log('[llamenos] Starting server...')

  const env = loadEnv()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required')
  }

  const db = initDb(env.DATABASE_URL)
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle', 'migrations') })
  console.log('[llamenos] Migrations applied')

  const services = createServices(db)

  const { default: workerApp } = await import('../../worker/app')

  // Create a top-level Hono app
  const app = new Hono()

  // Inject env bindings into every request via middleware
  app.use('*', async (c, next) => {
    // biome-ignore lint/suspicious/noExplicitAny: env injection into Hono context
    ;(c as any).env = env
    await next()
  })

  app.use('*', servicesMiddleware(services))

  // Mount the worker app routes
  // biome-ignore lint/suspicious/noExplicitAny: cross-platform mount
  app.route('/', workerApp as any)

  app.onError(errorHandler)

  // Static file serving (replaces CF ASSETS binding)
  // The worker app's catch-all calls next() when ASSETS is null,
  // allowing these middleware to serve static files on Node.js.
  const staticDir = path.resolve(process.cwd(), 'dist', 'client')
  app.use('*', serveStatic({ root: staticDir }))

  // SPA fallback — serve index.html for all unmatched routes
  app.use('*', serveStatic({ root: staticDir, path: '/index.html' }))

  const port = Number(process.env.PORT) || 3000
  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      console.log(`[llamenos] Server running at http://localhost:${info.port}`)
    }
  )

  // Graceful shutdown
  const shutdown = () => {
    console.log('[llamenos] Shutting down...')

    closeNostrPublisher()

    server.close(() => {
      console.log('[llamenos] Server stopped')
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('[llamenos] Failed to start:', err)
  process.exit(1)
})
