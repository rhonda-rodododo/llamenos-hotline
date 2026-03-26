import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// --- DOM mocks (must be set up before importing panic-wipe) ---

const localStore = new Map<string, string>()
let localStoreClearCalled = false
globalThis.localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => localStore.set(k, v),
  removeItem: (k: string) => localStore.delete(k),
  clear: () => {
    localStoreClearCalled = true
    localStore.clear()
  },
  get length() {
    return localStore.size
  },
  key: (i: number) => [...localStore.keys()][i] ?? null,
} as Storage

const sessionStore = new Map<string, string>()
let sessionStoreClearCalled = false
globalThis.sessionStorage = {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => sessionStore.set(k, v),
  removeItem: (k: string) => sessionStore.delete(k),
  clear: () => {
    sessionStoreClearCalled = true
    sessionStore.clear()
  },
  get length() {
    return sessionStore.size
  },
  key: (i: number) => [...sessionStore.keys()][i] ?? null,
} as Storage

globalThis.indexedDB = {
  databases: async () => [{ name: 'test-db' }],
  deleteDatabase: () => ({ result: undefined }),
} as unknown as IDBFactory

Object.defineProperty(globalThis, 'navigator', {
  value: { serviceWorker: { getRegistrations: async () => [] } },
  writable: true,
  configurable: true,
})

type EventHandler = (...args: unknown[]) => void
const listeners = new Map<string, EventHandler[]>()
globalThis.document = {
  addEventListener: (type: string, fn: EventHandler) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type)!.push(fn)
  },
  removeEventListener: (type: string, fn: EventHandler) => {
    const fns = listeners.get(type)
    if (fns)
      listeners.set(
        type,
        fns.filter((f) => f !== fn)
      )
  },
} as unknown as Document

let lastHref = ''
Object.defineProperty(globalThis, 'window', {
  value: {
    location: {
      get href() {
        return lastHref
      },
      set href(v: string) {
        lastHref = v
      },
    },
  },
  writable: true,
  configurable: true,
})

// --- No mock.module for key-manager ---
// Bun's mock.module is process-global and poisons the module for other test files.
// We let the real wipeKey() run and verify via side effects (redirect, storage clear).

import { initPanicWipe, performPanicWipe } from './panic-wipe'

function pressKey(key: string) {
  const fns = listeners.get('keydown') || []
  for (const fn of fns) {
    fn({ key })
  }
}

function pressEscape() {
  pressKey('Escape')
}

function cleanupPanicWipe(cleanupFn: () => void) {
  pressKey('Reset')
  cleanupFn()
}

// --- Tests ---

beforeEach(() => {
  lastHref = ''
  localStore.clear()
  sessionStore.clear()
  localStoreClearCalled = false
  sessionStoreClearCalled = false
})

describe('performPanicWipe', () => {
  test('does not throw when no onWipe callback is registered', () => {
    expect(() => performPanicWipe()).not.toThrow()
  })

  test('fires onWipe callback when registered via initPanicWipe', () => {
    let callbackFired = false
    const cleanup = initPanicWipe(() => {
      callbackFired = true
    })
    performPanicWipe()
    expect(callbackFired).toBe(true)
    cleanupPanicWipe(cleanup)
  })

  test('clears localStorage after flash delay', async () => {
    localStore.set('session', 'abc')
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 250))
    expect(localStoreClearCalled).toBe(true)
  })

  test('clears sessionStorage after flash delay', async () => {
    sessionStore.set('temp', 'data')
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 250))
    expect(sessionStoreClearCalled).toBe(true)
  })

  test('redirects to /login after flash delay', async () => {
    performPanicWipe()
    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')
  })

  test('redirect has not happened before setTimeout fires', () => {
    performPanicWipe()
    expect(lastHref).toBe('')
  })
})

describe('initPanicWipe', () => {
  test('returns a cleanup function', () => {
    const cleanup = initPanicWipe()
    expect(typeof cleanup).toBe('function')
    cleanupPanicWipe(cleanup)
  })

  test('cleanup removes keydown listener', () => {
    const cleanup = initPanicWipe()
    const listenersBefore = (listeners.get('keydown') || []).length
    expect(listenersBefore).toBeGreaterThan(0)

    cleanup()
    const listenersAfter = (listeners.get('keydown') || []).length
    expect(listenersAfter).toBe(listenersBefore - 1)
  })

  test('cleanup nullifies the onWipe callback', () => {
    let callbackFired = false
    const cleanup = initPanicWipe(() => {
      callbackFired = true
    })
    cleanup()
    performPanicWipe()
    expect(callbackFired).toBe(false)
  })

  test('registers a keydown listener on document', () => {
    const before = (listeners.get('keydown') || []).length
    const cleanup = initPanicWipe()
    const after = (listeners.get('keydown') || []).length
    expect(after).toBe(before + 1)
    cleanupPanicWipe(cleanup)
  })
})

describe('triple-Escape detection', () => {
  test('3 Escapes within window triggers wipe (redirect scheduled)', async () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    pressEscape()
    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')
    cleanupPanicWipe(cleanup)
  })

  test('2 Escapes does not trigger wipe', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup)
  })

  test('1 Escape does not trigger wipe', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup)
  })

  test('non-Escape key resets counter', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    pressKey('a')
    pressEscape()
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup)
  })

  test('counter resets after trigger — can trigger again', async () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    pressEscape()
    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')

    lastHref = ''
    pressEscape()
    pressEscape()
    pressEscape()
    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')
    cleanupPanicWipe(cleanup)
  })

  test('Escapes outside time window do not accumulate', async () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    await new Promise((r) => setTimeout(r, 1100))
    pressEscape()
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup)
  })

  test('fires onWipe callback on triple-Escape', () => {
    let callbackFired = false
    const cleanup = initPanicWipe(() => {
      callbackFired = true
    })
    pressEscape()
    pressEscape()
    pressEscape()
    expect(callbackFired).toBe(true)
    cleanupPanicWipe(cleanup)
  })

  test('mixed keys interspersed — only consecutive Escapes count', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressKey('Enter')
    pressEscape()
    pressKey('Tab')
    pressEscape()
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup)
  })
})
