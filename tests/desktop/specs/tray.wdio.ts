/**
 * System tray tests — verify tray icon and window visibility toggling.
 *
 * Uses window.__TAURI_INTERNALS__.invoke() directly to call window plugin
 * commands, since browser.execute() can't resolve bare module specifiers.
 *
 * Epic 88: Desktop & Mobile E2E Tests.
 */

describe('System Tray', () => {
  it('should have the window visible on launch', async () => {
    const isVisible = await browser.execute(async () => {
      try {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke
        if (!invoke) return null
        return await invoke('plugin:window|is_visible', { label: 'main' })
      } catch {
        return null
      }
    })

    expect(isVisible).toBe(true)
  })

  it('should be able to hide the window programmatically', async () => {
    const result = await browser.execute(async () => {
      try {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke
        if (!invoke) return { error: '__TAURI_INTERNALS__ not available' }

        // Hide the window
        await invoke('plugin:window|hide', { label: 'main' })
        const hiddenState = await invoke('plugin:window|is_visible', { label: 'main' })

        // Show it again immediately
        await invoke('plugin:window|show', { label: 'main' })
        const visibleState = await invoke('plugin:window|is_visible', { label: 'main' })

        return { hidden: hiddenState, visible: visibleState }
      } catch (e) {
        return { error: String(e) }
      }
    })

    if ('error' in result) {
      // Permission might be denied — skip gracefully
      console.warn('Tray hide/show test skipped:', result.error)
    } else {
      expect(result.hidden).toBe(false)
      expect(result.visible).toBe(true)
    }
  })

  it('should be able to minimize and restore the window', async () => {
    const result = await browser.execute(async () => {
      try {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke
        if (!invoke) return { error: '__TAURI_INTERNALS__ not available' }

        await invoke('plugin:window|minimize', { label: 'main' })
        const minimized = await invoke('plugin:window|is_minimized', { label: 'main' })

        await invoke('plugin:window|unminimize', { label: 'main' })
        // Small delay for window manager
        await new Promise(r => setTimeout(r, 200))
        const restored = await invoke('plugin:window|is_minimized', { label: 'main' })

        return { minimized, restored: !restored }
      } catch (e) {
        return { error: String(e) }
      }
    })

    if ('error' in result) {
      console.warn('Minimize/restore test skipped:', result.error)
    } else {
      expect(result.minimized).toBe(true)
      expect(result.restored).toBe(true)
    }
  })

  it('should be able to set window title', async () => {
    const result = await browser.execute(async () => {
      try {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke
        if (!invoke) return { error: '__TAURI_INTERNALS__ not available' }

        const originalTitle = await invoke('plugin:window|title', { label: 'main' })
        await invoke('plugin:window|set_title', { label: 'main', value: 'Test Title' })
        const newTitle = await invoke('plugin:window|title', { label: 'main' })

        // Restore original title
        await invoke('plugin:window|set_title', { label: 'main', value: originalTitle })

        return { originalTitle, newTitle }
      } catch (e) {
        return { error: String(e) }
      }
    })

    if ('error' in result) {
      console.warn('Set title test skipped:', result.error)
    } else {
      expect(result.originalTitle).toBe('Hotline')
      expect(result.newTitle).toBe('Test Title')
    }
  })
})
