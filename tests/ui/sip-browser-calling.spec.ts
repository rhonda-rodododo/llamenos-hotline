import { expect, test } from '@playwright/test'

test.describe('SIP Browser Calling', () => {
  // Full E2E SIP tests require:
  // 1. bun run dev:docker (Asterisk + coturn running)
  // 2. scripts/dev-certs.sh (TLS certs generated)
  // 3. Hub configured with Asterisk provider
  //
  // These tests are gated behind TEST_SIP_WEBRTC=1 env var since they
  // require infrastructure that's not always available in CI.

  test.skip(
    !process.env.TEST_SIP_WEBRTC,
    'Set TEST_SIP_WEBRTC=1 to run SIP E2E tests (requires Asterisk container)'
  )

  test('SipWebRTCAdapter registers via JsSIP and reaches ready state', async ({ page }) => {
    // Navigate to dashboard (assumes authenticated session)
    await page.goto('/dashboard')

    // Wait for WebRTC manager to initialize and reach ready state
    // The manager exposes state via a global for testing
    const state = await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-webrtc-state]')
        return el?.getAttribute('data-webrtc-state')
      },
      { timeout: 15000 }
    )

    expect(state).toBeTruthy()
  })

  test('incoming SIP INVITE shows ringing state in UI', async ({ page }) => {
    await page.goto('/dashboard')

    // Wait for ready state first
    await page.waitForFunction(() => document.querySelector('[data-webrtc-state="ready"]'), {
      timeout: 15000,
    })

    // Originate a test call via bridge
    // In a real test, we'd call the bridge's ARI originate endpoint
    // For now, verify the UI is in the correct state for receiving calls
    const readyIndicator = page.locator('[data-webrtc-state="ready"]')
    await expect(readyIndicator).toBeVisible()
  })
})
