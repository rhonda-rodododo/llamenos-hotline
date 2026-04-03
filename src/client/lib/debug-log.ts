/**
 * Dev-only debug logger. Logs are stripped from production builds
 * via Vite's dead-code elimination (import.meta.env.DEV is false in prod).
 *
 * Usage:
 *   const log = createDebugLog('WebRTCManager')
 *   log('Incoming call', callSid)   // → [WebRTCManager] Incoming call CA123
 */
export function createDebugLog(namespace: string) {
  return (...args: unknown[]) => {
    if (import.meta.env.DEV) {
      console.log(`[${namespace}]`, ...args)
    }
  }
}
