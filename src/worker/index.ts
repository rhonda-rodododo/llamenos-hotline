import app from './app'
import { createDatabase } from '../server/db'
import { createServices } from '../server/services'
import type { Env } from './types'

export default {
  fetch: app.fetch,

  /**
   * CF Cron Trigger handler — resets all services when DEMO_MODE is enabled.
   * Visitors arrive at a fresh state → setup wizard → full onboarding experience.
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    if (env.DEMO_MODE !== 'true') return
    if (!env.DATABASE_URL) {
      console.error('Demo reset: DATABASE_URL not configured')
      return
    }

    const db = createDatabase(env.DATABASE_URL)
    const services = createServices(db)

    await Promise.all([
      services.identity.resetForTest(),
      services.settings.resetForTest(),
      services.records.resetForTest(),
      services.shifts.resetForTest(),
      services.calls.resetForTest(),
      services.conversations.resetForTest(),
      services.blasts.resetForTest(),
    ])
  },
}
