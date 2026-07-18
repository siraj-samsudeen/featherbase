import { expect, test } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

// Ticketing demo app (migration 0047): the generic Desk renders the Ticket
// DocType — list, form, and workflow actions — with zero bespoke frontend.
test('ticketing: seeded tickets render in the Desk and open with workflow actions', async ({
  page,
}) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/desk/)

  await page.goto('/desk/Ticket')
  await expect(page.getByText('TICK-0001')).toBeVisible()
  await expect(
    page.getByText('Sales mismatch between DW and SAP for store CHN-02'),
  ).toBeVisible()

  await page.getByText('TICK-0001').click()
  await expect(page.getByTestId('form-view')).toBeVisible()
  await expect(page.getByTestId('workflow-actions')).toContainText('Open')
  await expect(page.getByTestId('workflow-action-Start Progress')).toBeVisible()
})
