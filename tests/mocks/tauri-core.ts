/**
 * Mock @tauri-apps/api/core for Playwright test builds.
 * Routes IPC commands to JS crypto implementations via the handler.
 * Stubs Resource, Channel, PluginListener, etc. for Tauri plugin compatibility.
 */

import { handleInvoke } from './tauri-ipc-handler'

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return handleInvoke(cmd, args ?? {}) as Promise<T>
}

export function transformCallback(_callback: (response: unknown) => void): number {
  return 0 // Stub
}

// Stub classes used by @tauri-apps/plugin-updater, plugin-notification, etc.

export class Resource {
  #rid: number
  get rid() { return this.#rid }
  constructor(rid: number) { this.#rid = rid }
  async close(): Promise<void> { /* no-op */ }
}

export class Channel<T = unknown> {
  id = 0
  #onmessage: (message: T) => void
  constructor(onmessage?: (message: T) => void) {
    this.#onmessage = onmessage || (() => {})
  }
  set onmessage(handler: (message: T) => void) { this.#onmessage = handler }
  get onmessage() { return this.#onmessage }
  toJSON(): string { return `__CHANNEL__:${this.id}` }
  cleanupCallback(): void { /* no-op */ }
}

export class PluginListener {
  plugin: string
  event: string
  channelId: number
  constructor(plugin: string, event: string, channelId: number) {
    this.plugin = plugin
    this.event = event
    this.channelId = channelId
  }
  async unregister(): Promise<void> { /* no-op */ }
}

export async function addPluginListener(
  _plugin: string,
  _event: string,
  _cb: (payload: unknown) => void,
): Promise<PluginListener> {
  return new PluginListener(_plugin, _event, 0)
}

export function isTauri(): boolean {
  return false // Test builds run in regular browser
}

export const SERIALIZE_TO_IPC_FN = Symbol('serializeToIpc')
