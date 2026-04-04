/**
 * Structured JSON logger for production observability.
 *
 * Outputs JSON lines to stdout for consumption by log aggregators
 * (Loki, Elasticsearch, CloudWatch, etc.).
 *
 * Emits structured JSON with timestamps, levels, and component tags.
 * Falls back to console methods when running outside of a Node/Bun process.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const isNode = typeof process !== 'undefined' && process.env?.PLATFORM === 'node'

// Minimum log level — configurable via LOG_LEVEL env var
const minLevel: LogLevel = isNode ? (process.env.LOG_LEVEL as LogLevel) || 'info' : 'info'

interface LogEntry {
  level: LogLevel
  ts: string
  component: string
  msg: string
  [key: string]: unknown
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel]
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return

  if (isNode) {
    // Structured JSON output for log aggregators
    const line = JSON.stringify(entry)
    if (entry.level === 'error') {
      process.stderr.write(`${line}\n`)
    } else {
      process.stdout.write(`${line}\n`)
    }
  } else {
    // Fallback: use console methods for non-Node/Bun environments
    const { level, component, msg, ...extra } = entry
    const prefix = `[${component}]`
    const hasExtra = Object.keys(extra).length > 1 // ts is always there
    switch (level) {
      case 'debug':
        console.debug(prefix, msg, ...(hasExtra ? [extra] : []))
        break
      case 'info':
        console.log(prefix, msg, ...(hasExtra ? [extra] : []))
        break
      case 'warn':
        console.warn(prefix, msg, ...(hasExtra ? [extra] : []))
        break
      case 'error':
        console.error(prefix, msg, ...(hasExtra ? [extra] : []))
        break
    }
  }
}

/**
 * Create a component-scoped logger.
 *
 * @example
 * const log = createLogger('auth')
 * log.info('Token verified', { pubkey: '...' })
 * // → {"level":"info","ts":"...","component":"auth","msg":"Token verified","pubkey":"..."}
 */
export function createLogger(component: string) {
  function log(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    emit({
      level,
      ts: new Date().toISOString(),
      component,
      msg,
      ...extra,
    })
  }

  return {
    debug: (msg: string, extra?: Record<string, unknown>) => log('debug', msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra),
  }
}
