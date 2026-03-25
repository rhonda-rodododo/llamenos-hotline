/**
 * Unit tests for the WebRTCManager module.
 *
 * These tests verify the module's exported functions exist and reflect correct
 * initial state without attempting to load telephony SDKs (which are browser-only
 * and use dynamic imports under @vite-ignore).
 */
import { describe, expect, it } from 'bun:test'
import {
  acceptCall,
  destroyWebRtc,
  getState,
  hangupCall,
  hasIncomingCall,
  initWebRtc,
  isConnected,
  isMuted,
  onStateChange,
  rejectCall,
  toggleMute,
} from './manager'

describe('WebRTCManager exports', () => {
  it('exports all required functions', () => {
    expect(typeof getState).toBe('function')
    expect(typeof onStateChange).toBe('function')
    expect(typeof initWebRtc).toBe('function')
    expect(typeof acceptCall).toBe('function')
    expect(typeof rejectCall).toBe('function')
    expect(typeof hangupCall).toBe('function')
    expect(typeof toggleMute).toBe('function')
    expect(typeof isMuted).toBe('function')
    expect(typeof destroyWebRtc).toBe('function')
    expect(typeof isConnected).toBe('function')
    expect(typeof hasIncomingCall).toBe('function')
  })
})

describe('WebRTCManager initial state', () => {
  it('starts in idle state', () => {
    expect(getState()).toBe('idle')
  })

  it('isConnected returns false when idle', () => {
    expect(isConnected()).toBe(false)
  })

  it('hasIncomingCall returns false when idle', () => {
    expect(hasIncomingCall()).toBe(false)
  })

  it('isMuted returns false when no adapter', () => {
    expect(isMuted()).toBe(false)
  })

  it('toggleMute returns false when no adapter', () => {
    expect(toggleMute()).toBe(false)
  })
})

describe('WebRTCManager state change subscriptions', () => {
  it('onStateChange registers a handler and returns an unsubscribe function', () => {
    const received: string[] = []
    const unsubscribe = onStateChange((state) => received.push(state))
    expect(typeof unsubscribe).toBe('function')

    // Trigger a state change via destroyWebRtc (which sets idle)
    destroyWebRtc()
    expect(received).toContain('idle')

    unsubscribe()
    // After unsubscribe, further state changes should not reach this handler
    const lengthBefore = received.length
    destroyWebRtc()
    expect(received.length).toBe(lengthBefore)
  })

  it('state change handler can unsubscribe without affecting other handlers', () => {
    const log1: string[] = []
    const log2: string[] = []

    const unsub1 = onStateChange((s) => log1.push(s))
    const unsub2 = onStateChange((s) => log2.push(s))

    destroyWebRtc()
    expect(log1.length).toBeGreaterThan(0)
    expect(log2.length).toBeGreaterThan(0)

    unsub1()
    const len1 = log1.length
    const len2 = log2.length

    destroyWebRtc()
    expect(log1.length).toBe(len1) // unsub'd — no new events
    expect(log2.length).toBeGreaterThan(len2) // still subscribed

    unsub2()
  })
})

describe('WebRTCManager no-ops on missing adapter', () => {
  it('acceptCall does nothing when no adapter is set', () => {
    expect(() => acceptCall()).not.toThrow()
  })

  it('rejectCall does nothing when no adapter is set', () => {
    expect(() => rejectCall()).not.toThrow()
  })

  it('hangupCall does nothing when no adapter is set', () => {
    expect(() => hangupCall()).not.toThrow()
  })

  it('destroyWebRtc is safe to call repeatedly', () => {
    expect(() => {
      destroyWebRtc()
      destroyWebRtc()
      destroyWebRtc()
    }).not.toThrow()
    expect(getState()).toBe('idle')
  })
})
