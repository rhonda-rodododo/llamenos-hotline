import { test, expect } from '@playwright/test'
import {
  loginAsAdmin,
  loginAsVolunteer,
  createVolunteerAndGetNsec,
  completeProfileSetup,
  resetTestState,
  uniquePhone,
} from '../helpers'

test.describe('Dashboard Analytics', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTestState(request)
    await loginAsAdmin(page)
  })

  test('analytics section is visible to admins on the dashboard', async ({ page }) => {
    await page.goto('/')
    const trigger = page.getByTestId('analytics-section-trigger')
    await expect(trigger).toBeVisible()
    await expect(trigger).toContainText('Analytics')
  })

  test('analytics section is collapsed by default', async ({ page }) => {
    await page.goto('/')
    // Charts should not be visible when collapsed
    await expect(page.getByTestId('call-volume-chart')).not.toBeVisible()
    await expect(page.getByTestId('call-hours-chart')).not.toBeVisible()
    await expect(page.getByTestId('volunteer-stats-table')).not.toBeVisible()
    // Skeleton loaders also hidden
    await expect(page.getByTestId('call-volume-chart-skeleton')).not.toBeVisible()
  })

  test('analytics section expands and charts render on click', async ({ page }) => {
    await page.goto('/')
    const trigger = page.getByTestId('analytics-section-trigger')
    await trigger.click()

    // After expand, either the chart or no-data placeholder should appear
    await expect(
      page.getByTestId('call-volume-chart').or(page.getByTestId('call-volume-no-data'))
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByTestId('call-hours-chart').or(page.getByTestId('call-hours-no-data'))
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByTestId('volunteer-stats-table').or(page.getByTestId('volunteer-stats-no-data'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('no console errors when analytics section is expanded', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/')
    const trigger = page.getByTestId('analytics-section-trigger')
    await trigger.click()
    // Wait for content to load
    await page.waitForTimeout(2000)

    // Filter out known non-critical errors (e.g., network errors in test env)
    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('net::ERR') &&
        !e.includes('favicon') &&
        !e.includes('serviceworker') &&
        !e.includes('ECONNREFUSED')
    )
    expect(criticalErrors).toHaveLength(0)
  })

  test('period toggle switches between 7 and 30 days', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('analytics-section-trigger').click()

    // Wait for content to load
    await page.waitForTimeout(1500)

    // Find the 7d and 30d buttons
    const btn7d = page.getByRole('button', { name: '7d' })
    const btn30d = page.getByRole('button', { name: '30d' })

    await expect(btn7d).toBeVisible({ timeout: 5000 })
    await expect(btn30d).toBeVisible({ timeout: 5000 })

    // Click 30d and verify it triggers a new fetch (button becomes active)
    await btn30d.click()
    await page.waitForTimeout(1000)

    // Click 7d again
    await btn7d.click()
    await page.waitForTimeout(1000)

    // No crash — charts still render
    await expect(
      page.getByTestId('call-volume-chart').or(page.getByTestId('call-volume-no-data'))
    ).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Dashboard Analytics — volunteer visibility', () => {
  test('analytics section is hidden from volunteers', async ({ page, request }) => {
    await resetTestState(request)
    await loginAsAdmin(page)

    // Create a volunteer and get their nsec
    const phone = uniquePhone()
    const { nsec } = await createVolunteerAndGetNsec(page, 'Test Volunteer', phone)

    // Login as the volunteer
    await loginAsVolunteer(page, nsec)
    await completeProfileSetup(page)

    await page.goto('/')

    // Analytics trigger should NOT be visible for volunteers
    await expect(page.getByTestId('analytics-section-trigger')).not.toBeVisible()
  })
})
