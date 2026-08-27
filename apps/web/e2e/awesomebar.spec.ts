import { test, expect, adminToken, bearer, type APIRequestContext } from './fixtures'

const DT = 'Awesome DT'
const DOC = 'zephyr-unique-doc'

// UI-014: awesomebar surfaces Tables, documents, and "new X" actions;
// Enter navigates to the top document hit's form.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const token = await adminToken(request)
  const auth = bearer(token)
  const dt = await request.post('/api/table_def', {
    headers: auth,
    data: {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`table: ${dt.status()}`)
  const doc = await request.post(`/api/table/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { row_id: DOC, note: 'searchable' },
  })
  if (![201, 409].includes(doc.status())) throw new Error(`doc: ${doc.status()}`)
})

test('UI-014: typing a doc name surfaces it and Enter opens its form', async ({ page }) => {
  await page.goto('/admin')
  const bar = page.getByTestId('awesomebar').locator('input')

  // Document hit appears and click navigates.
  await bar.fill('zephyr-uni')
  const hit = page.getByTestId('awesomebar-doc').first()
  await expect(hit).toContainText(DOC)
  await expect(hit).toContainText(DT)
  await hit.click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()

  await page.goto('/admin')

  // Enter on a typed doc name goes straight to the form.
  await bar.fill('zephyr-unique-doc')
  await expect(page.getByTestId('awesomebar-doc').first()).toBeVisible()
  await bar.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()

  await page.goto('/admin')

  // "New X" action for a matched Table.
  await bar.fill('Awesome')
  const newAction = page.getByTestId('awesomebar-new').first()
  await expect(newAction).toContainText(`New ${DT}`)
  await newAction.click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/new`))
})
