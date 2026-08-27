import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// #203/#205 (issue #197): the owner's actual session — "I imported one of the
// sheets and then there was an error in the second sheet", after which the
// finished import and the only link to the Import Log both became
// unreachable.
//
// The loop used to sit inside one try, so a throw on target 2 left targets
// 3..n unattempted and skipped the completion block — which held the sole
// link to the log.

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const FIRST = 'Partial First'
const THIRD = 'Partial Third'

async function adminToken(request: APIRequestContext) {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  return ((await login.json()) as { token: string }).token
}

async function login(page: Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)
}

function workbook(): Buffer {
  const wb = XLSX.utils.book_new()
  for (const [name, header] of [
    ['One', 'Pf One'],
    ['Two', 'Pf Two'],
    ['Three', 'Pf Three'],
  ] as const) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[header, 'Pf Note'], ['a', 'x'], ['b', 'y']]),
      name,
    )
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

test.beforeEach(async ({ request }) => {
  const token = await adminToken(request)
  for (const n of [FIRST, THIRD, 'One', 'Two', 'Three']) await deleteTableIfExists(request, token, n)
})

test('a failing target does not abandon the rest of the run', async ({ page, request }) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await login(page)

  // Make the SECOND target fail at the server, the way a real one would:
  // refuse only its create call. The first and third must be untouched.
  await page.route('**/api/table_def', async (route) => {
    const body = route.request().postDataJSON() as { name?: string }
    if (body?.name === 'Partial Second') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ exception: 'ServerError', message: 'Simulated failure' }),
      })
    }
    return route.continue()
  })

  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'partial failure.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()

  await page.getByTestId('iw-new-name-0').fill(FIRST)
  await page.getByTestId('iw-new-name-1').fill('Partial Second')
  await page.getByTestId('iw-new-name-2').fill(THIRD)
  await page.getByTestId('iw-import').click()

  // Target 1 imported and its result SURVIVES the later failure.
  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')
  // Target 2 failed, named, in its own place.
  await expect(page.getByTestId('iw-failure-1')).toContainText('Partial Second failed')
  // Target 3 was still ATTEMPTED — the defect was that it never ran.
  await expect(page.getByTestId('iw-result-2')).toContainText('Imported 2 rows')

  // The run reports all of it rather than vanishing.
  await expect(page.getByTestId('iw-done')).toContainText('1 failed')

  // And the Tables really exist / do not.
  const tables = await request.get('/api/table/Table?limit_page_length=500', { headers })
  const names = ((await tables.json()) as { data: { row_id: string }[] }).data.map((t) => t.row_id)
  expect(names).toContain(FIRST)
  expect(names).toContain(THIRD)
  expect(names).not.toContain('Partial Second')

  for (const n of [FIRST, THIRD]) await deleteTableIfExists(request, token, n)
})

test('the committed result stays revertable after a later failure', async ({ page, request }) => {
  const token = await adminToken(request)
  await login(page)
  await page.route('**/api/table_def', async (route) => {
    const body = route.request().postDataJSON() as { name?: string }
    if (body?.name === 'Partial Second') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ exception: 'ServerError', message: 'Simulated failure' }),
      })
    }
    return route.continue()
  })

  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'partial failure.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-new-name-0').fill(FIRST)
  await page.getByTestId('iw-new-name-1').fill('Partial Second')
  await page.getByTestId('iw-new-name-2').fill(THIRD)
  await page.getByTestId('iw-import').click()

  await expect(page.getByTestId('iw-result-0')).toContainText('Imported 2 rows')
  // Undoing what DID land must remain possible — a failure elsewhere is not
  // a reason to strand a run that committed.
  await expect(page.getByTestId('iw-revert-open-0')).toBeVisible()

  for (const n of [FIRST, THIRD]) await deleteTableIfExists(request, token, n)
})

test('the Import Log is reachable before a run, and after one fails', async ({ page }) => {
  await login(page)
  await page.getByTestId('import-data-link').click()

  // #205: present immediately — not gated behind a clean run, which is when
  // it is least needed.
  await expect(page.getByTestId('iw-history-link')).toBeVisible()

  await page.route('**/api/table_def', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ exception: 'ServerError', message: 'Simulated failure' }),
    }),
  )
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'partial failure.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook(),
  })
  await page.getByTestId('iw-ov-master').check()
  await page.getByTestId('iw-ov-continue').click()
  await page.getByTestId('iw-import').click()

  // Everything failed — the exact case that used to hide the link.
  await expect(page.getByTestId('iw-done')).toContainText('failed')
  await expect(page.getByTestId('iw-history-link')).toBeVisible()
  await page.getByTestId('iw-history-link').click()
  await expect(page).toHaveURL(/Import%20Log/)
})
