import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// --- DOM mocks (must be set up before importing panic-wipe) ---

const localStore = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => localStore.set(k, v),
  removeItem: (k: string) => localStore.delete(k),
  clear: () => localStore.clear(),
  get length() {
    return localStore.size
  },
  key: (i: number) => [...localStore.keys()][i] ?? null,
} as Storage

const sessionStore = new Map<string, string>()
globalThis.sessionStorage = {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => sessionStore.set(k, v),
  removeItem: (k: string) => sessionStore.delete(k),
  clear: () => sessionStore.clear(),
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

// --- Mock key-manager before importing panic-wipe ---

let wipeKeyCalled = false
mock.module('./key-manager', () => ({
  wipeKey: () => {
    wipeKeyCalled = true
  },
}))

// Import AFTER mocking
const { performPanicWipe, initPanicWipe } = await import('./panic-wipe')

// --- Helpers ---

function pressKey(key: string) {
  const fns = listeners.get('keydown') || []
  for (const fn of fns) {
    fn({ key })
  }
}

function pressEscape() {
  pressKey('Escape')
}

/** Reset module-level escapeTimes by pressing a non-Escape key, then remove the listener. */
function cleanupPanicWipe(cleanupFn: () => void) {
  pressKey('Reset') // resets escapeTimes to []
  cleanupFn()
}

// --- Tests ---

beforeEach(() => {
  wipeKeyCalled = false
  lastHref = ''
  localStore.clear()
  sessionStore.clear()
})

describe('performPanicWipe', () => {
  test('calls wipeKey', () => {
    performPanicWipe()
    expect(wipeKeyCalled).toBe(true)
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

  test('does not throw when no onWipe callback is registered', () => {
    expect(() => performPanicWipe()).not.toThrow()
  })

  test('clears localStorage after flash delay', async () => {
    localStore.set('session', 'abc')
    localStore.set('keys', 'xyz')
    performPanicWipe()

    // Storage clearing is deferred via setTimeout(200ms)
    await new Promise((r) => setTimeout(r, 250))
    expect(localStore.size).toBe(0)
  })

  test('clears sessionStorage after flash delay', async () => {
    sessionStore.set('temp', 'data')
    performPanicWipe()

    await new Promise((r) => setTimeout(r, 250))
    expect(sessionStore.size).toBe(0)
  })

  test('redirects to /login after flash delay', async () => {
    performPanicWipe()

    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')
  })

  test('wipeKey is called synchronously before setTimeout fires', () => {
    performPanicWipe()
    // wipeKey should be called immediately, not deferred
    expect(wipeKeyCalled).toBe(true)
    // But redirect has not happened yet (it is in setTimeout)
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

    // After cleanup, performPanicWipe should not fire the callback
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
  test('3 Escapes within window triggers wipe', async () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    pressEscape()

    expect(wipeKeyCalled).toBe(true)

    await new Promise((r) => setTimeout(r, 250))
    expect(lastHref).toBe('/login')
    // escapeTimes already reset by the trigger itself (line 93 in source)
    cleanupPanicWipe(cleanup)
  })

  test('2 Escapes does not trigger wipe', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()

    expect(wipeKeyCalled).toBe(false)
    expect(lastHref).toBe('')
    cleanupPanicWipe(cleanup) // resets escapeTimes via non-Escape key
  })

  test('1 Escape does not trigger wipe', () => {
    const cleanup = initPanicWipe()
    pressEscape()

    expect(wipeKeyCalled).toBe(false)
    cleanupPanicWipe(cleanup)
  })

  test('non-Escape key resets counter', () => {
    const cleanup = initPanicWipe()
    pressEscape()
    pressEscape()
    pressKey('a') // resets counter
    pressEscape()

    // Only 1 Escape after reset
    expect(wipeKeyCalled).toBe(false)
    cleanupPanicWipe(cleanup)
  })

  test('counter resets after trigger — can trigger again', async () => {
    const cleanup = initPanicWipe()

    // First trigger
    pressEscape()
    pressEscape()
    pressEscape()
    expect(wipeKeyCalled).toBe(true)

    // Wait for the setTimeout to complete
    await new Promise((r) => setTimeout(r, 250))

    // Reset tracking
    wipeKeyCalled = false
    lastHref = ''

    // Second trigger
    pressEscape()
    pressEscape()
    pressEscape()
    expect(wipeKeyCalled).toBe(true)

    cleanupPanicWipe(cleanup)
  })

  test('Escapes outside time window do not accumulate', async () => {
    const cleanup = initPanicWipe()

    pressEscape()
    pressEscape()

    // Wait longer than the 1000ms window
    await new Promise((r) => setTimeout(r, 1100))

    // This is the first Escape in the new window
    pressEscape()
    expect(wipeKeyCalled).toBe(false)

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
    pressKey('Enter') // resets
    pressEscape()
    pressKey('Tab') // resets
    pressEscape()

    expect(wipeKeyCalled).toBe(false)
    cleanupPanicWipe(cleanup)
  })
})
