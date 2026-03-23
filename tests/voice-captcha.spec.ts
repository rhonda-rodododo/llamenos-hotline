import { test, expect } from '@playwright/test'
import { loginAsAdmin, resetTestState } from './helpers'

/**
 * Voice CAPTCHA E2E tests.
 *
 * These tests exercise the CAPTCHA flow via API requests that simulate
 * telephony webhooks, plus UI tests for the admin settings.
 */
test.describe('Voice CAPTCHA', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ request }) => {
    await resetTestState(request)
  })

  // --- Test 5.1: CAPTCHA disabled — call routes directly ---
  test('CAPTCHA disabled — language-selected returns enqueue (no CAPTCHA)', async ({ request }) => {
    // Ensure CAPTCHA is disabled (default after reset)
    const spamRes = await request.get('/api/settings/spam')
    expect(spamRes.ok()).toBeTruthy()
    const spam = await spamRes.json()
    expect(spam.voiceCaptchaEnabled).toBe(false)

    // Simulate inbound call webhook (Twilio format)
    const incomingRes = await request.post('/api/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-nocaptcha-001&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(incomingRes.ok()).toBeTruthy()

    const body = await incomingRes.text()
    // Should contain Enqueue (direct to queue, no CAPTCHA Gather)
    expect(body).toContain('Enqueue')
    expect(body).not.toMatch(/captcha/i)
  })

  // --- Test 5.2: CAPTCHA enabled — challenge presented ---
  test('CAPTCHA enabled — language-selected returns CAPTCHA Gather', async ({ request }) => {
    // Enable CAPTCHA via API
    const enableRes = await request.patch('/api/settings/spam', {
      data: { voiceCaptchaEnabled: true },
    })
    expect(enableRes.ok()).toBeTruthy()
    const updated = await enableRes.json()
    expect(updated.voiceCaptchaEnabled).toBe(true)

    // Simulate inbound call
    const callRes = await request.post('/api/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-captcha-002&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(callRes.ok()).toBeTruthy()

    const body = await callRes.text()
    // Should contain Gather for CAPTCHA digits
    expect(body).toContain('Gather')
    expect(body).toContain('numDigits="4"')
    expect(body).toContain('/api/telephony/captcha')
    // Should NOT contain Enqueue yet
    expect(body).not.toContain('Enqueue')
  })

  // --- Test 5.3: Correct DTMF passes CAPTCHA ---
  test('correct DTMF digits pass CAPTCHA and enqueue call', async ({ request }) => {
    // First generate a challenge by hitting language-selected
    const callRes = await request.post('/api/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-captcha-003&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(callRes.ok()).toBeTruthy()

    // Extract the expected digits from the TwiML response
    const twiml = await callRes.text()
    // The digits are spoken as "d, d, d, d." inside a <Say> element
    const digitMatch = twiml.match(/>(\d), (\d), (\d), (\d)\.<\/Say>/)
    expect(digitMatch).toBeTruthy()
    const expectedDigits = `${digitMatch![1]}${digitMatch![2]}${digitMatch![3]}${digitMatch![4]}`

    // Verify all digits are 1-9 (no zeros)
    for (const d of expectedDigits) {
      expect(Number(d)).toBeGreaterThanOrEqual(1)
      expect(Number(d)).toBeLessThanOrEqual(9)
    }

    // Submit correct CAPTCHA digits
    const captchaRes = await request.post(
      `/api/telephony/captcha?callSid=test-captcha-003&lang=en`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: `CallSid=test-captcha-003&From=%2B15551234567&Digits=${expectedDigits}`,
      }
    )
    expect(captchaRes.ok()).toBeTruthy()

    const captchaBody = await captchaRes.text()
    // Should contain Enqueue (call passed CAPTCHA)
    expect(captchaBody).toContain('Enqueue')
    expect(captchaBody).not.toContain('Hangup')
  })

  // --- Test 5.4: Incorrect DTMF triggers retry, then rejection ---
  test('incorrect DTMF triggers retry then rejection after max attempts', async ({ request }) => {
    // Set max attempts to 2
    const settingsRes = await request.patch('/api/settings/spam', {
      data: { captchaMaxAttempts: 2 },
    })
    expect(settingsRes.ok()).toBeTruthy()

    // Generate challenge
    const callRes = await request.post('/api/telephony/language-selected?auto=1', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'CallSid=test-captcha-004&From=%2B15551234567&To=%2B15559999999&Digits=2',
    })
    expect(callRes.ok()).toBeTruthy()

    // First wrong attempt — should get retry
    const attempt1 = await request.post(
      `/api/telephony/captcha?callSid=test-captcha-004&lang=en`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'CallSid=test-captcha-004&From=%2B15551234567&Digits=0000',
      }
    )
    expect(attempt1.ok()).toBeTruthy()
    const body1 = await attempt1.text()
    // Should be a retry (re-gather)
    expect(body1).toContain('Gather')
    expect(body1).not.toContain('Enqueue')
    expect(body1).not.toContain('Hangup')

    // Second wrong attempt — should get rejection (hangup)
    const attempt2 = await request.post(
      `/api/telephony/captcha?callSid=test-captcha-004&lang=en`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'CallSid=test-captcha-004&From=%2B15551234567&Digits=0000',
      }
    )
    expect(attempt2.ok()).toBeTruthy()
    const body2 = await attempt2.text()
    // Should contain hangup (rejected after max attempts)
    expect(body2).toContain('Hangup')
    expect(body2).not.toContain('Enqueue')
    expect(body2).not.toContain('Gather')
  })

  // --- Test 5.5: Expired challenge rejects ---
  test('expired challenge returns rejection', async ({ request }) => {
    // Submit CAPTCHA for a callSid that was never generated (simulates expiry)
    const captchaRes = await request.post(
      `/api/telephony/captcha?callSid=test-captcha-expired&lang=en`,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'CallSid=test-captcha-expired&From=%2B15551234567&Digits=1234',
      }
    )
    expect(captchaRes.ok()).toBeTruthy()

    const body = await captchaRes.text()
    // Should reject (no stored challenge = expired)
    expect(body).toContain('Hangup')
    expect(body).not.toContain('Enqueue')
  })

  // --- Admin UI: captchaMaxAttempts setting ---
  test('admin can set captchaMaxAttempts in spam settings UI', async ({ page, request }) => {
    await loginAsAdmin(page)
    await page.getByRole('link', { name: 'Hub Settings' }).click()
    await expect(page.getByRole('heading', { name: 'Hub Settings', exact: true })).toBeVisible()

    // Expand spam section
    await page.getByText('Spam Mitigation').first().click()

    // Enable CAPTCHA if not already enabled
    const captchaSwitch = page.locator('text=Voice CAPTCHA').locator('..').locator('..').locator('..').getByRole('switch')
    const isChecked = await captchaSwitch.isChecked()
    if (!isChecked) {
      // Need to enable via confirmation dialog
      await captchaSwitch.click()
      // Handle potential confirmation dialog
      const confirmBtn = page.getByRole('button', { name: /confirm|enable/i })
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click()
      }
    }

    // Max attempts input should now be visible
    const maxAttemptsInput = page.locator('#captcha-max-attempts')
    await expect(maxAttemptsInput).toBeVisible({ timeout: 5000 })

    // Change value to 3
    await maxAttemptsInput.clear()
    await maxAttemptsInput.fill('3')
    await maxAttemptsInput.press('Tab') // trigger onChange

    // Verify it was saved via API
    const spamRes = await request.get('/api/settings/spam')
    const spam = await spamRes.json()
    expect(spam.captchaMaxAttempts).toBe(3)

    // Cleanup: disable CAPTCHA
    await request.patch('/api/settings/spam', {
      data: { voiceCaptchaEnabled: false },
    })
  })
})
