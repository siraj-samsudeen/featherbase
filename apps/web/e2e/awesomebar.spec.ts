import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Awesome DT'
const DOC = 'zephyr-unique-doc'

// UI-014: awesomebar surfaces DocTypes, documents, and "new X" actions;
// Enter navigates to the top document hit's form.

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const token = ((await login.json()) as { token: string }).token
  const auth = { Authorization: `Bearer ${token}` }
  const dt = await request.post('/api/doctype', {
    headers: auth,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [{ fieldname: 'note', fieldtype: 'Data', in_list_view: true }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  const doc = await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers: auth,
    data: { name: DOC, note: 'searchable' },
  })
  if (![201, 409].includes(doc.status())) throw new Error(`doc: ${doc.status()}`)
})

test('UI-014: typing a doc name surfaces it and Enter opens its form', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  const bar = page.getByTestId('awesomebar').locator('input')

  // Document hit appears and click navigates.
  await bar.fill('zephyr-uni')
  const hit = page.getByTestId('awesomebar-doc').first()
  await expect(hit).toContainText(DOC)
  await expect(hit).toContainText(DT)
  await hit.click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()

  // Enter on a typed doc name goes straight to the form.
  await page.goto('/desk')
  await bar.fill('zephyr-unique-doc')
  await expect(page.getByTestId('awesomebar-doc').first()).toBeVisible()
  await bar.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/${DOC}`))
  await expect(page.getByTestId('form-view')).toBeVisible()

  // "New X" action for a matched DocType.
  await page.goto('/desk')
  await bar.fill('Awesome')
  const newAction = page.getByTestId('awesomebar-new').first()
  await expect(newAction).toContainText(`New ${DT}`)
  await newAction.click()
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(DT)}/new`))
})
