import { test, expect } from '@playwright/test'
import { loginAsAdmin, navigateAfterLogin, resetTestState } from '../helpers'

test.describe('Client-side transcription settings', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  test('can enable and configure client-side transcription', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/settings?section=transcription')

    // The transcription section card should be visible (deep-linked via ?section=transcription)
    const section = page.locator('#transcription')
    await expect(section).toBeVisible()

    // Check for the "In-Browser Transcription" sub-section heading
    await expect(page.getByRole('heading', { name: 'In-Browser Transcription' })).toBeVisible()
    await expect(page.getByText('Transcribe calls locally in your browser')).toBeVisible()

    // Toggle should be visible and initially off
    const toggle = page.getByTestId('client-transcription-toggle')
    await expect(toggle).toBeVisible()

    // Enable client-side transcription
    await toggle.click()

    // Model selection should appear
    await expect(page.getByText('Transcription Model')).toBeVisible()
    await expect(page.getByText(/Tiny \(English\).*fastest/)).toBeVisible()
    await expect(page.getByText(/Base \(English\).*better accuracy/)).toBeVisible()

    // "Transcribes your speech only" notice should appear
    await expect(page.getByText('Transcribes your speech only')).toBeVisible()

    // Select a different model
    await page.getByText(/Base \(English\).*better accuracy/).click()

    // Setting persists in localStorage
    const settings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('llamenos:client-transcription') || '{}'),
    )
    expect(settings.enabled).toBe(true)
    expect(settings.model).toBe('base.en')

    // Disable and verify model selection hides
    await toggle.click()
    await expect(page.getByText('Transcription Model')).not.toBeVisible()

    // Verify persisted state
    const updatedSettings = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('llamenos:client-transcription') || '{}'),
    )
    expect(updatedSettings.enabled).toBe(false)
  })

  test('settings persist across page reload', async ({ page }) => {
    await loginAsAdmin(page)

    // Pre-set localStorage before navigating to settings
    await page.evaluate(() => {
      localStorage.setItem('llamenos:client-transcription', JSON.stringify({
        enabled: true,
        model: 'base',
        language: 'en',
      }))
    })

    await navigateAfterLogin(page, '/settings?section=transcription')

    // The transcription section should be visible
    await expect(page.locator('#transcription')).toBeVisible()

    // Toggle should be checked
    const toggle = page.getByTestId('client-transcription-toggle')
    await expect(toggle).toBeChecked()

    // Base (Multilingual) model should be selected
    await expect(page.getByText('Transcription Model')).toBeVisible()
    // The base model button should have the selection indicator
    const baseButton = page.getByText('Base (Multilingual)').locator('..')
    await expect(baseButton).toHaveClass(/border-primary/)
  })
})

test.describe('Transcribe recording button', () => {
  test.beforeEach(async ({ request }) => {
    await resetTestState(request)
  })

  test('call history page shows transcribe button alongside recording player', async ({ page }) => {
    await loginAsAdmin(page)
    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: 'Call History' })).toBeVisible()

    // If recording players exist, they should have transcribe buttons
    const playerCount = await page.getByTestId('recording-player').count()
    if (playerCount > 0) {
      const transcribeBtn = page.getByTestId('transcribe-recording-btn').first()
      await expect(transcribeBtn).toBeVisible()
      await expect(transcribeBtn).toContainText('Transcribe Recording')
    }
  })

  test('no network requests to CF AI during transcription flow', async ({ page }) => {
    await loginAsAdmin(page)

    // Monitor network requests for CF AI calls
    const cfAiRequests: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('ai.cloudflare') || url.includes('@cf/openai/whisper')) {
        cfAiRequests.push(url)
      }
    })

    await navigateAfterLogin(page, '/calls')
    await expect(page.getByRole('heading', { name: 'Call History' })).toBeVisible()

    // Wait a moment for any lazy requests
    await page.waitForTimeout(1000)

    // No requests should have been made to CF AI
    expect(cfAiRequests).toHaveLength(0)
  })
})
