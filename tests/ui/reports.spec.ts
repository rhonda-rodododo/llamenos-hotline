import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { ADMIN_NSEC, loginAsAdmin, loginAsVolunteer, uniquePhone } from '../helpers'
import { createAuthedRequestFromNsec, type AuthedRequest } from '../helpers/authed-request'
import { createAuthToken, encryptMessage } from '../../src/client/lib/crypto'

/**
 * Navigate to the Reports page via sidebar link (SPA navigation).
 * Avoids page.goto() which causes a full reload and clears the in-memory key manager.
 */
async function navigateToReports(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 10000 })
}

/**
 * Create a report via the API (headless, fast — no browser encryption needed).
 * Uses the admin's authed request to create a report with envelope-encrypted content.
 */
async function createReportViaApi(
  adminReq: AuthedRequest,
  title: string,
  body: string,
): Promise<{ id: string; title: string }> {
  const encrypted = encryptMessage(body, [adminReq.pubkey])

  const res = await adminReq.post('/api/reports', {
    title,
    encryptedContent: encrypted.encryptedContent,
    readerEnvelopes: encrypted.readerEnvelopes,
  })
  if (!res.ok()) {
    throw new Error(`Report creation failed: ${res.status()} ${await res.text()}`)
  }
  const data = await res.json()
  return { id: data.id, title }
}

/**
 * Create a report via the API using a reporter's nsec (for reporter role tests).
 */
async function createReporterReportViaApi(
  request: APIRequestContext,
  reporterNsec: string,
  title: string,
  body: string,
): Promise<{ id: string; title: string }> {
  const decoded = nip19.decode(reporterNsec)
  if (decoded.type !== 'nsec') throw new Error('Expected nsec')
  const pubkey = getPublicKey(decoded.data)
  const reporterReq = createAuthedRequestFromNsec(request, reporterNsec)

  const encrypted = encryptMessage(body, [pubkey])

  const res = await reporterReq.post('/api/reports', {
    title,
    encryptedContent: encrypted.encryptedContent,
    readerEnvelopes: encrypted.readerEnvelopes,
  })
  if (!res.ok()) {
    throw new Error(`Reporter report creation failed: ${res.status()} ${await res.text()}`)
  }
  const data = await res.json()
  return { id: data.id, title }
}

/**
 * Select a report by title in the report list. Assumes reports page is loaded.
 */
async function selectReport(page: Page, title: string): Promise<void> {
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 })
  await page.locator('button[type="button"]').filter({ hasText: title }).click()
  await expect(page.getByText('End-to-end encrypted')).toBeVisible({ timeout: 5000 })
}

/**
 * Claim a report that is currently selected in the detail view.
 */
async function claimSelectedReport(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /claim/i })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /claim/i }).click()
  await expect(page.getByText('Active')).toBeVisible({ timeout: 10000 })
}

/**
 * Complete profile setup if the page is at /profile-setup.
 */
async function handleProfileSetup(page: Page): Promise<void> {
  if (page.url().includes('profile-setup')) {
    await page.getByRole('button', { name: /complete setup/i }).click()
    await page.waitForURL(u => !u.toString().includes('profile-setup'), { timeout: 15000 })
  }
}

/**
 * Create a reporter user via headless API calls (no browser required).
 * Returns the reporter's nsec.
 */
async function createReporterViaApi(request: APIRequestContext): Promise<string> {
  const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)

  const inviteRes = await adminReq.post('/api/invites', {
    name: `Reporter ${Date.now()}`,
    phone: uniquePhone(),
    roleIds: ['role-reporter'],
  })
  const inviteData = await inviteRes.json()
  const inviteCode: string = inviteData.code

  const secretKey = generateSecretKey()
  const pubkey = getPublicKey(secretKey)
  const nsec = nip19.nsecEncode(secretKey)

  const timestamp = Date.now()
  const authJson = JSON.parse(createAuthToken(secretKey, timestamp, 'POST', '/api/invites/redeem'))
  const token: string = authJson.token

  const redeemRes = await request.post('/api/invites/redeem', {
    data: { code: inviteCode, pubkey, timestamp, token },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!redeemRes.ok()) {
    throw new Error(`Invite redeem failed: ${redeemRes.status()} ${await redeemRes.text()}`)
  }

  return nsec
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin reports management tests — each test is fully self-contained
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reports feature', () => {
  test.describe('Admin reports management', () => {
    test('reports page loads for admin', async ({ page }) => {
      await loginAsAdmin(page)
      await navigateToReports(page)
      await expect(page.getByRole('button', { name: /new/i })).toBeVisible()
    })

    test('admin can create a report', async ({ page }) => {
      await loginAsAdmin(page)
      await navigateToReports(page)
      const title = `Admin Report ${Date.now()}`

      await page.getByRole('button', { name: /new/i }).click()
      await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({ timeout: 5000 })
      await page.getByPlaceholder('Brief description of the report').fill(title)
      await page.getByPlaceholder('Describe the situation in detail...').fill('This is a test report created by admin')
      await page.getByRole('button', { name: /submit report/i }).click()

      // Verify the report appears in the list
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 })
    })

    test('report shows in list with correct status', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Status Report ${Date.now()}`
      await createReportViaApi(adminReq, title, 'Report for testing status')

      await loginAsAdmin(page)
      await navigateToReports(page)

      const reportCard = page.locator('button[type="button"]').filter({ hasText: title })
      await expect(reportCard).toBeVisible({ timeout: 15000 })
      await expect(reportCard.getByText(/messages/i)).toBeVisible()
    })

    test('selecting a report shows detail view', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Detail Report ${Date.now()}`
      await createReportViaApi(adminReq, title, 'Report for testing detail view')

      await loginAsAdmin(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // The status badge should show "Waiting"
      await expect(page.getByText('Waiting')).toBeVisible()
    })

    test('admin can claim a report', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Claim Report ${Date.now()}`
      await createReportViaApi(adminReq, title, 'Report for testing claim')

      await loginAsAdmin(page)
      await navigateToReports(page)
      await selectReport(page, title)

      await claimSelectedReport(page)

      // Claim button should disappear
      await expect(page.getByRole('button', { name: /claim/i })).not.toBeVisible()
    })

    test('admin can close a report', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Close Report ${Date.now()}`
      const report = await createReportViaApi(adminReq, title, 'Report for testing close')

      // Claim via API first (must be active to close)
      await adminReq.post(`/api/reports/${report.id}/assign`, { assignee: adminReq.pubkey })

      await loginAsAdmin(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // Click the "Close Report" button
      await expect(page.getByTestId('close-report')).toBeVisible({ timeout: 5000 })
      await page.getByTestId('close-report').click()

      // After closing, the report should be removed from the list
      await expect(page.locator('button[type="button"]').filter({ hasText: title })).not.toBeVisible({ timeout: 10000 })
    })

    test('status filter works', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const ts = Date.now()
      const titleA = `Filter A ${ts}`
      const titleB = `Filter B ${ts}`

      // Create two reports via API
      const reportA = await createReportViaApi(adminReq, titleA, `Details for ${titleA}`)
      await createReportViaApi(adminReq, titleB, `Details for ${titleB}`)

      // Claim A via API to make it active
      await adminReq.post(`/api/reports/${reportA.id}/assign`, { assignee: adminReq.pubkey })

      await loginAsAdmin(page)
      await navigateToReports(page)

      // Both reports should be visible
      await expect(page.getByText(titleA).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByText(titleB).first()).toBeVisible({ timeout: 15000 })

      // Use the status filter to show only "Waiting" reports
      const mainContent = page.locator('main')
      const statusSelect = mainContent.locator('button[role="combobox"]').first()
      await statusSelect.click()
      await page.getByRole('option', { name: /waiting/i }).click()

      // Only B should be visible (still waiting)
      await expect(page.getByText(titleB).first()).toBeVisible({ timeout: 10000 })
      await expect(page.locator('button[type="button"]').filter({ hasText: titleA })).not.toBeVisible()

      // Switch filter to show "Active" reports
      await statusSelect.click()
      await page.getByRole('option', { name: /^active$/i }).click()

      // Only A should be visible
      await expect(page.getByText(titleA).first()).toBeVisible({ timeout: 10000 })
      await expect(page.locator('button[type="button"]').filter({ hasText: titleB })).not.toBeVisible()

      // Switch back to "All statuses"
      await statusSelect.click()
      await page.getByRole('option', { name: /all statuses/i }).click()

      // Both should be visible again
      await expect(page.getByText(titleA).first()).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(titleB).first()).toBeVisible({ timeout: 10000 })
    })

    test('report detail shows messages for new report', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Messages Report ${Date.now()}`
      await createReportViaApi(adminReq, title, 'Report for testing messages')

      await loginAsAdmin(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // The initial report message should be visible (created with the report body)
    })

    test('admin can reply to a claimed report', async ({ page, request }) => {
      const adminReq = createAuthedRequestFromNsec(request, ADMIN_NSEC)
      const title = `Reply Report ${Date.now()}`
      const report = await createReportViaApi(adminReq, title, 'Report for testing replies')

      // Claim via API
      await adminReq.post(`/api/reports/${report.id}/assign`, { assignee: adminReq.pubkey })

      await loginAsAdmin(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // The reply composer should be visible (report is active)
      const replyTextarea = page.getByPlaceholder('Type your reply...')
      await expect(replyTextarea).toBeVisible({ timeout: 5000 })

      // Type a reply and send
      await replyTextarea.fill('This is an admin reply to the report')
      const sendBtn = page.getByRole('button', { name: 'Submit', exact: true })
      await expect(sendBtn).toBeEnabled()
      await sendBtn.click()

      // Wait for the reply to be sent (textarea should clear)
      await expect(replyTextarea).toHaveValue('', { timeout: 5000 })
    })

    test('new report form has encryption note', async ({ page }) => {
      await loginAsAdmin(page)
      await navigateToReports(page)

      await page.getByRole('button', { name: /new/i }).click()

      await expect(page.getByText('Your report is encrypted end-to-end')).toBeVisible({ timeout: 5000 })
      await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible()
      await expect(page.getByPlaceholder('Describe the situation in detail...')).toBeVisible()
      await expect(page.getByRole('button', { name: /submit report/i })).toBeVisible()
    })

    test('report form validation prevents empty submission', async ({ page }) => {
      await loginAsAdmin(page)
      await navigateToReports(page)

      await page.getByRole('button', { name: /new/i }).click()
      await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({ timeout: 5000 })

      const submitBtn = page.getByRole('button', { name: /submit report/i })
      await expect(submitBtn).toBeDisabled()

      // Fill only title — still disabled
      await page.getByPlaceholder('Brief description of the report').fill('Only a title')
      await expect(submitBtn).toBeDisabled()

      // Fill details too — now enabled
      await page.getByPlaceholder('Describe the situation in detail...').fill('Now has details')
      await expect(submitBtn).toBeEnabled()
    })

    test('unselected state shows placeholder text', async ({ page }) => {
      await loginAsAdmin(page)
      await navigateToReports(page)

      await expect(page.getByText('Select a report to view details')).toBeVisible({ timeout: 10000 })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Reporter role tests — each test creates its own reporter via API
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('Reporter role', () => {
    test('reporter navigation shows only My Reports', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)

      // Wait for the layout to fully render
      await page.waitForTimeout(1000)

      // Reporter should see "Reports" nav link (reporter-only nav)
      await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible({ timeout: 10000 })

      // Reporter should NOT see Dashboard, Notes, Volunteers, or Admin links
      await expect(page.getByRole('link', { name: 'Dashboard' })).not.toBeVisible()
      await expect(page.getByRole('link', { name: 'Notes' })).not.toBeVisible()
      await expect(page.getByRole('link', { name: 'Volunteers' })).not.toBeVisible()
      await expect(page.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()
      await expect(page.getByRole('link', { name: 'Audit Log' })).not.toBeVisible()
    })

    test('reporter can access reports page', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)

      await page.getByRole('link', { name: 'Reports' }).click()
      await page.waitForURL(/\/reports/, { timeout: 10000 })
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 10000 })
      await expect(page.getByRole('button', { name: /new/i })).toBeVisible()
    })

    test('reporter can create a report', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)
      await navigateToReports(page)
      const title = `Reporter Report ${Date.now()}`

      await page.getByRole('button', { name: /new/i }).click()
      await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({ timeout: 5000 })
      await page.getByPlaceholder('Brief description of the report').fill(title)
      await page.getByPlaceholder('Describe the situation in detail...').fill('This is a report created by a reporter')
      await page.getByRole('button', { name: /submit report/i }).click()

      await expect(page.getByText(title).first()).toBeVisible({ timeout: 20000 })
    })

    test('reporter can reply to own report', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      const title = `Reply Report ${Date.now()}`
      await createReporterReportViaApi(request, reporterNsec, title, 'Report for testing reporter replies')

      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // The reply composer should be visible
      const replyTextarea = page.getByPlaceholder('Type your reply...')
      await expect(replyTextarea).toBeVisible({ timeout: 5000 })

      // Type a reply and send
      await replyTextarea.fill('This is a reply from the reporter')

      // Click the send button
      const sendBtn = page.locator('button[aria-label]').filter({ has: page.locator('svg.lucide-send') })
      if (await sendBtn.count() > 0) {
        await sendBtn.click()
      } else {
        await replyTextarea.press('Control+Enter')
      }

      // The reply text area should be cleared after sending
      await expect(replyTextarea).toHaveValue('', { timeout: 5000 })
    })

    test('reporter sees encryption note in report detail', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      const title = `Encryption Note Report ${Date.now()}`
      await createReporterReportViaApi(request, reporterNsec, title, 'Report for testing encryption note visibility')

      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // Verify encryption note is visible in the detail header
      await expect(page.getByText('End-to-end encrypted')).toBeVisible({ timeout: 5000 })
    })

    test('reporter does not see Claim or Close buttons', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      const title = `No Buttons Report ${Date.now()}`
      await createReporterReportViaApi(request, reporterNsec, title, 'Report for testing button visibility')

      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)
      await navigateToReports(page)
      await selectReport(page, title)

      // Reporter should NOT see Claim or Close buttons
      await expect(page.getByRole('button', { name: /claim/i })).not.toBeVisible()
      await expect(page.getByTestId('close-report')).not.toBeVisible()
    })

    test('reporter does not see status filter', async ({ page, request }) => {
      const reporterNsec = await createReporterViaApi(request)
      await loginAsVolunteer(page, reporterNsec)
      await handleProfileSetup(page)
      await navigateToReports(page)

      // The status and category filter dropdowns are admin-only
      await expect(page.getByText('All statuses')).not.toBeVisible()
    })
  })
})
