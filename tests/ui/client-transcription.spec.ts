import { expect, test } from '../fixtures/auth'
import { navigateAfterLogin } from '../helpers'

test.describe('Client-side transcription settings', () => {
  test('can enable and configure client-side transcription', async ({ adminPage }) => {
    await navigateAfterLogin(adminPage, '/settings?section=transcription')

    // The transcription section card should be visible (deep-linked via ?section=transcription)
    const section = adminPage.locator('#transcription')
    await expect(section).toBeVisible()

    // Check for the "In-Browser Transcription" sub-section heading
    await expect(adminPage.getByRole('heading', { name: 'In-Browser Transcription' })).toBeVisible()
    await expect(adminPage.getByText('Transcribe calls locally in your browser')).toBeVisible()

    // Toggle should be visible and initially off
    const toggle = adminPage.getByTestId('client-transcription-toggle')
    await expect(toggle).toBeVisible()

    // Enable client-side transcription
    await toggle.click()

    // Model selection should appear
    await expect(adminPage.getByText('Transcription Model')).toBeVisible()
    await expect(adminPage.getByText(/Tiny \(English\).*fastest/)).toBeVisible()
    await expect(adminPage.getByText(/Base \(English\).*better accuracy/)).toBeVisible()

    // "Transcribes your speech only" notice should appear
    await expect(adminPage.getByText('Transcribes your speech only')).toBeVisible()

    // Select a different model
    await adminPage.getByText(/Base \(English\).*better accuracy/).click()

    // Setting persists in localStorage
    const settings = await adminPage.evaluate(() =>
      JSON.parse(localStorage.getItem('llamenos:client-transcription') || '{}')
    )
    expect(settings.enabled).toBe(true)
    expect(settings.model).toBe('base.en')

    // Disable and verify model selection hides
    await toggle.click()
    await expect(adminPage.getByText('Transcription Model')).not.toBeVisible()

    // Verify persisted state
    const updatedSettings = await adminPage.evaluate(() =>
      JSON.parse(localStorage.getItem('llamenos:client-transcription') || '{}')
    )
    expect(updatedSettings.enabled).toBe(false)
  })

  test('settings persist across page reload', async ({ adminPage }) => {
    // Pre-set localStorage before navigating to settings
    await adminPage.evaluate(() => {
      localStorage.setItem(
        'llamenos:client-transcription',
        JSON.stringify({
          enabled: true,
          model: 'base',
          language: 'en',
        })
      )
    })

    await navigateAfterLogin(adminPage, '/settings?section=transcription')

    // The transcription section should be visible
    await expect(adminPage.locator('#transcription')).toBeVisible()

    // Toggle should be checked
    const toggle = adminPage.getByTestId('client-transcription-toggle')
    await expect(toggle).toBeChecked()

    // Base (Multilingual) model should be selected
    await expect(adminPage.getByText('Transcription Model')).toBeVisible()
    // The base model button should have the selection indicator
    const baseButton = adminPage.getByText('Base (Multilingual)').locator('..')
    await expect(baseButton).toHaveClass(/border-primary/)
  })
})

test.describe('Transcribe recording button', () => {
  test('call history page shows transcribe button alongside recording player', async ({
    adminPage,
  }) => {
    await navigateAfterLogin(adminPage, '/calls')
    await expect(adminPage.getByRole('heading', { name: 'Call History' })).toBeVisible()

    // If recording players exist, they should have transcribe buttons
    const playerCount = await adminPage.getByTestId('recording-player').count()
    if (playerCount > 0) {
      const transcribeBtn = adminPage.getByTestId('transcribe-recording-btn').first()
      await expect(transcribeBtn).toBeVisible()
      await expect(transcribeBtn).toContainText('Transcribe Recording')
    }
  })

  test('no network requests to CF AI during transcription flow', async ({ adminPage }) => {
    // Monitor network requests for CF AI calls
    const cfAiRequests: string[] = []
    adminPage.on('request', (request) => {
      const url = request.url()
      if (url.includes('ai.cloudflare') || url.includes('@cf/openai/whisper')) {
        cfAiRequests.push(url)
      }
    })

    await navigateAfterLogin(adminPage, '/calls')
    await expect(adminPage.getByRole('heading', { name: 'Call History' })).toBeVisible()

    // Wait a moment for any lazy requests
    await adminPage.waitForTimeout(1000)

    // No requests should have been made to CF AI
    expect(cfAiRequests).toHaveLength(0)
  })
})
