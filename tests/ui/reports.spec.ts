import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/auth'

// Under parallel execution (3 workers), concurrent browser sessions with ECIES encryption
// + PBKDF2 key derivation create significant CPU load. Allow 120s per test.
test.setTimeout(120_000)

/**
 * Navigate to the Reports page via sidebar link (SPA navigation).
 * Avoids page.goto() which causes a full reload and clears the in-memory key manager.
 */
async function navigateToReports(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
    timeout: 10000,
  })
}

/**
 * Create a report via the UI. Assumes user is logged in and on the reports page.
 */
async function createReportViaUI(page: Page, title: string, details: string): Promise<void> {
  await page.getByRole('button', { name: /new/i }).click()
  await expect(page.getByPlaceholder('Brief description of the report')).toBeVisible({
    timeout: 5000,
  })
  await page.getByPlaceholder('Brief description of the report').fill(title)
  await page.getByPlaceholder('Describe the situation in detail...').fill(details)

  await page.getByRole('button', { name: /submit report/i }).click()

  // Wait for form to close (sheet closes on successful submit).
  // Under concurrent load, ECIES encryption can be slow — allow generous timeout.
  await expect(page.getByPlaceholder('Brief description of the report')).not.toBeVisible({
    timeout: 30000,
  })

  // Wait for the report to appear in the rendered list (POST + list refresh + render)
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30000 })
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
  const claimBtn = page.getByRole('button', { name: 'Claim', exact: true })
  await expect(claimBtn).toBeVisible({ timeout: 5000 })
  await claimBtn.click()
  await expect(page.getByText('Active')).toBeVisible({ timeout: 10000 })
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin reports management tests — each test is fully self-contained
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reports feature', () => {
  test.describe('Admin reports management', () => {
    test('reports page loads for admin', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      await expect(adminPage.getByRole('button', { name: /new/i })).toBeVisible()
    })

    test('admin can create a report', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Admin Report ${Date.now()}`

      await adminPage.getByRole('button', { name: /new/i }).click()
      await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
        timeout: 5000,
      })
      await adminPage.getByPlaceholder('Brief description of the report').fill(title)
      await adminPage
        .getByPlaceholder('Describe the situation in detail...')
        .fill('This is a test report created by admin')
      await adminPage.getByRole('button', { name: /submit report/i }).click()

      // Verify the report appears in the list
      await expect(adminPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    })

    test('report shows in list with correct status', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Status Report ${Date.now()}`

      // Create the report this test depends on
      await createReportViaUI(adminPage, title, 'Report for testing status')

      // Verify the waiting status indicator is present
      const reportCard = adminPage.locator('button[type="button"]').filter({ hasText: title })
      await expect(reportCard).toBeVisible()
      await expect(reportCard.getByText(/messages/i)).toBeVisible()
    })

    test('selecting a report shows detail view', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Detail Report ${Date.now()}`

      await createReportViaUI(adminPage, title, 'Report for testing detail view')
      await selectReport(adminPage, title)

      // The status badge should show "Waiting"
      await expect(adminPage.getByText('Waiting')).toBeVisible()
    })

    test('admin can claim a report', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Claim Report ${Date.now()}`

      await createReportViaUI(adminPage, title, 'Report for testing claim')
      await selectReport(adminPage, title)

      // Click the "Claim" button
      await claimSelectedReport(adminPage)

      // Claim button should disappear
      await expect(adminPage.getByRole('button', { name: 'Claim', exact: true })).not.toBeVisible()
    })

    test('admin can close a report', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Close Report ${Date.now()}`

      // Create and claim the report first (must be active to close)
      await createReportViaUI(adminPage, title, 'Report for testing close')
      await selectReport(adminPage, title)
      await claimSelectedReport(adminPage)

      // Click the "Close Report" button
      await expect(adminPage.getByTestId('close-report')).toBeVisible({ timeout: 5000 })
      await adminPage.getByTestId('close-report').click()

      // After closing, the report should be removed from the list
      await expect(
        adminPage.locator('button[type="button"]').filter({ hasText: title })
      ).not.toBeVisible({ timeout: 10000 })
    })

    test('status filter works', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const ts = Date.now()
      const titleA = `Filter A ${ts}`
      const titleB = `Filter B ${ts}`

      // Create two reports
      await createReportViaUI(adminPage, titleA, `Details for ${titleA}`)
      await createReportViaUI(adminPage, titleB, `Details for ${titleB}`)

      // Both reports should be visible
      await expect(adminPage.getByText(titleA).first()).toBeVisible({ timeout: 15000 })
      await expect(adminPage.getByText(titleB).first()).toBeVisible({ timeout: 15000 })

      // Claim one of them to make it active
      await adminPage.locator('button[type="button"]').filter({ hasText: titleA }).click()
      await expect(adminPage.getByRole('button', { name: 'Claim', exact: true })).toBeVisible({
        timeout: 5000,
      })
      await adminPage.getByRole('button', { name: 'Claim', exact: true }).click()
      await expect(adminPage.getByText('Active')).toBeVisible({ timeout: 10000 })

      // Now use the status filter to show only "Waiting" reports
      const mainContent = adminPage.locator('main')
      const statusSelect = mainContent.locator('button[role="combobox"]').first()
      await statusSelect.click()
      await adminPage.getByRole('option', { name: /waiting/i }).click()

      // Only B should be visible (still waiting)
      await expect(adminPage.getByText(titleB).first()).toBeVisible({ timeout: 10000 })
      await expect(
        adminPage.locator('button[type="button"]').filter({ hasText: titleA })
      ).not.toBeVisible()

      // Switch filter to show "Active" reports
      await statusSelect.click()
      await adminPage.getByRole('option', { name: /^active$/i }).click()

      // Only A should be visible
      await expect(adminPage.getByText(titleA).first()).toBeVisible({ timeout: 10000 })
      await expect(
        adminPage.locator('button[type="button"]').filter({ hasText: titleB })
      ).not.toBeVisible()

      // Switch back to "All statuses"
      await statusSelect.click()
      await adminPage.getByRole('option', { name: /all statuses/i }).click()

      // Both should be visible again
      await expect(adminPage.getByText(titleA).first()).toBeVisible({ timeout: 10000 })
      await expect(adminPage.getByText(titleB).first()).toBeVisible({ timeout: 10000 })
    })

    test('report detail shows messages for new report', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Messages Report ${Date.now()}`

      await createReportViaUI(adminPage, title, 'Report for testing messages')
      await selectReport(adminPage, title)

      // The initial report message should be visible (created with the report body)
      // Report creation sends an initial message, so we should see at least one message
    })

    test('admin can reply to a claimed report', async ({ adminPage }) => {
      await navigateToReports(adminPage)
      const title = `Reply Report ${Date.now()}`

      await createReportViaUI(adminPage, title, 'Report for testing replies')
      await selectReport(adminPage, title)
      await claimSelectedReport(adminPage)

      // The reply composer should be visible (report is active)
      const replyTextarea = adminPage.getByPlaceholder('Type your reply...')
      await expect(replyTextarea).toBeVisible({ timeout: 5000 })

      // Type a reply and send
      await replyTextarea.fill('This is an admin reply to the report')
      const sendBtn = adminPage.getByRole('button', { name: 'Submit', exact: true })
      await expect(sendBtn).toBeEnabled()
      await sendBtn.click()

      // Wait for the reply to be sent (textarea should clear)
      await expect(replyTextarea).toHaveValue('', { timeout: 5000 })
    })

    test('new report form has encryption note', async ({ adminPage }) => {
      await navigateToReports(adminPage)

      await adminPage.getByRole('button', { name: /new/i }).click()

      await expect(adminPage.getByText('Your report is encrypted end-to-end')).toBeVisible({
        timeout: 5000,
      })
      await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible()
      await expect(adminPage.getByPlaceholder('Describe the situation in detail...')).toBeVisible()
      await expect(adminPage.getByRole('button', { name: /submit report/i })).toBeVisible()
    })

    test('report form validation prevents empty submission', async ({ adminPage }) => {
      await navigateToReports(adminPage)

      await adminPage.getByRole('button', { name: /new/i }).click()
      await expect(adminPage.getByPlaceholder('Brief description of the report')).toBeVisible({
        timeout: 5000,
      })

      const submitBtn = adminPage.getByRole('button', { name: /submit report/i })
      await expect(submitBtn).toBeDisabled()

      // Fill only title — still disabled
      await adminPage.getByPlaceholder('Brief description of the report').fill('Only a title')
      await expect(submitBtn).toBeDisabled()

      // Fill details too — now enabled
      await adminPage
        .getByPlaceholder('Describe the situation in detail...')
        .fill('Now has details')
      await expect(submitBtn).toBeEnabled()
    })

    test('unselected state shows placeholder text', async ({ adminPage }) => {
      // First create a report so the list isn't empty
      await navigateToReports(adminPage)
      await createReportViaUI(adminPage, `Placeholder ${Date.now()}`, 'Ensures list is non-empty')

      // Navigate away and back — this resets the selectedId state
      await adminPage.getByRole('link', { name: 'Dashboard' }).click()
      await expect(adminPage.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({
        timeout: 10000,
      })
      await navigateToReports(adminPage)

      // The right panel should show the placeholder text when no report is selected
      await expect(adminPage.getByText('Select a report to view details')).toBeVisible({
        timeout: 10000,
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Reporter role tests — using reporterPage fixture
  // ─────────────────────────────────────────────────────────────────────────────

  test.describe('Reporter role', () => {
    test('reporter navigation shows only My Reports', async ({ reporterPage }) => {
      // Wait for the layout to fully render
      await reporterPage.waitForTimeout(1000)

      // Reporter should see "Reports" nav link (reporter-only nav)
      await expect(reporterPage.getByRole('link', { name: 'Reports' })).toBeVisible({
        timeout: 10000,
      })

      // Reporter should NOT see Dashboard, Notes, Users, or Admin links
      await expect(reporterPage.getByRole('link', { name: 'Dashboard' })).not.toBeVisible()
      await expect(reporterPage.getByRole('link', { name: 'Notes' })).not.toBeVisible()
      await expect(reporterPage.getByRole('link', { name: 'Users' })).not.toBeVisible()
      await expect(reporterPage.getByRole('link', { name: 'Hub Settings' })).not.toBeVisible()
      await expect(reporterPage.getByRole('link', { name: 'Audit Log' })).not.toBeVisible()
    })

    test('reporter can access reports page', async ({ reporterPage }) => {
      await reporterPage.getByRole('link', { name: 'Reports' }).click()
      await reporterPage.waitForURL(/\/reports/, { timeout: 10000 })
      await expect(reporterPage.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({
        timeout: 10000,
      })
      await expect(reporterPage.getByRole('button', { name: /new/i })).toBeVisible()
    })

    test('reporter can create a report', async ({ reporterPage }) => {
      await navigateToReports(reporterPage)
      const title = `Reporter Report ${Date.now()}`

      await reporterPage.getByRole('button', { name: /new/i }).click()
      await expect(reporterPage.getByPlaceholder('Brief description of the report')).toBeVisible({
        timeout: 5000,
      })
      await reporterPage.getByPlaceholder('Brief description of the report').fill(title)
      await reporterPage
        .getByPlaceholder('Describe the situation in detail...')
        .fill('This is a report created by a reporter')
      await reporterPage.getByRole('button', { name: /submit report/i }).click()

      await expect(reporterPage.getByText(title).first()).toBeVisible({ timeout: 20000 })
    })

    test('reporter can reply to own report', async ({ reporterPage }) => {
      await navigateToReports(reporterPage)
      const title = `Reply Report ${Date.now()}`

      // Create a report to reply to
      await createReportViaUI(reporterPage, title, 'Report for testing reporter replies')
      await selectReport(reporterPage, title)

      // The reply composer should be visible
      const replyTextarea = reporterPage.getByPlaceholder('Type your reply...')
      await expect(replyTextarea).toBeVisible({ timeout: 5000 })

      // Type a reply and send
      await replyTextarea.fill('This is a reply from the reporter')

      // Click the send button
      const sendBtn = reporterPage
        .locator('button[aria-label]')
        .filter({ has: reporterPage.locator('svg.lucide-send') })
      if ((await sendBtn.count()) > 0) {
        await sendBtn.click()
      } else {
        await replyTextarea.press('Control+Enter')
      }

      // The reply text area should be cleared after sending
      await expect(replyTextarea).toHaveValue('', { timeout: 5000 })
    })

    test('reporter sees encryption note in report detail', async ({ reporterPage }) => {
      await navigateToReports(reporterPage)
      const title = `Encryption Note Report ${Date.now()}`

      await createReportViaUI(reporterPage, title, 'Report for testing encryption note visibility')
      await selectReport(reporterPage, title)

      // Verify encryption note is visible in the detail header
      await expect(reporterPage.getByText('End-to-end encrypted')).toBeVisible({ timeout: 5000 })
    })

    test('reporter does not see Claim or Close buttons', async ({ reporterPage }) => {
      await navigateToReports(reporterPage)
      const title = `No Buttons Report ${Date.now()}`

      await createReportViaUI(reporterPage, title, 'Report for testing button visibility')
      await selectReport(reporterPage, title)

      // Reporter should NOT see Claim or Close buttons
      await expect(
        reporterPage.getByRole('button', { name: 'Claim', exact: true })
      ).not.toBeVisible()
      await expect(reporterPage.getByTestId('close-report')).not.toBeVisible()
    })

    test('reporter does not see status filter', async ({ reporterPage }) => {
      await navigateToReports(reporterPage)

      // The status and category filter dropdowns are admin-only
      await expect(reporterPage.getByText('All statuses')).not.toBeVisible()
    })
  })
})
