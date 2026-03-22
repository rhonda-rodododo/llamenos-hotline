/**
 * Prometheus-compatible metrics endpoint.
 *
 * Exposes key operational metrics at /api/metrics for scraping by
 * Prometheus, Grafana Agent, or similar collectors.
 *
 * Metrics are collected in-memory and reset on process restart.
 * On CF Workers, this endpoint returns minimal metrics (uptime only)
 * since CF provides its own analytics.
 */
import { Hono } from 'hono'
import type { AppEnv } from '../types'

const metrics = new Hono<AppEnv>()

// In-memory counters and histograms
const counters: Record<string, number> = {}
const histograms: Record<string, number[]> = {}

const startTime = Date.now()

/** Increment a counter metric */
export function incCounter(name: string, labels?: Record<string, string>): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')}}`
    : name
  counters[key] = (counters[key] || 0) + 1
}

/** Record a histogram observation (in seconds) */
export function observeHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  const key = labels
    ? `${name}{${Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')}}`
    : name
  if (!histograms[key]) histograms[key] = []
  histograms[key].push(value)
}

/** Format metrics as Prometheus text exposition */
function formatMetrics(): string {
  const lines: string[] = []

  // Process uptime
  const uptimeSeconds = (Date.now() - startTime) / 1000
  lines.push('# HELP llamenos_uptime_seconds Process uptime in seconds')
  lines.push('# TYPE llamenos_uptime_seconds gauge')
  lines.push(`llamenos_uptime_seconds ${uptimeSeconds.toFixed(1)}`)

  // Counters
  for (const [key, value] of Object.entries(counters)) {
    const name = key.split('{')[0]
    if (!lines.some((l) => l.includes(`# TYPE ${name}`))) {
      lines.push(`# TYPE ${name} counter`)
    }
    lines.push(`${key} ${value}`)
  }

  // Histograms — emit count and sum
  const histogramNames = new Set<string>()
  for (const [key, values] of Object.entries(histograms)) {
    const name = key.split('{')[0]
    if (!histogramNames.has(name)) {
      histogramNames.add(name)
      lines.push(`# TYPE ${name} summary`)
    }
    const count = values.length
    const sum = values.reduce((a, b) => a + b, 0)
    const labelPart = key.includes('{') ? key.slice(key.indexOf('{')) : ''
    lines.push(`${name}_count${labelPart} ${count}`)
    lines.push(`${name}_sum${labelPart} ${sum.toFixed(6)}`)
  }

  return `${lines.join('\n')}\n`
}

metrics.get('/', (c) => {
  return new Response(formatMetrics(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
})

export default metrics
