import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'
const DT = 'Lh DT'

// PRN-004: a Letter Head's header/footer is applied to the print view — the
// default one is used automatically, a specific one can be chosen, and it can
// be suppressed. The header interpolates document fields like a Print Format.

let docName = ''

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const login = await request.post('/api/login', { data: { usr: 'Administrator', pwd: ADMIN_PWD } })
  const headers = { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` }

  const dt = await request.post('/api/doctype', {
    headers,
    data: {
      name: DT,
      autoname: 'prompt',
      fields: [{ fieldname: 'customer', fieldtype: 'Data' }],
    },
  })
  if (![201, 409].includes(dt.status())) throw new Error(`doctype: ${dt.status()}`)
  docName = 'lh-doc'
  await request.delete(`/api/resource/${encodeURIComponent(DT)}/${docName}`, { headers })
  await request.post(`/api/resource/${encodeURIComponent(DT)}`, {
    headers,
    data: { name: docName, customer: 'Wayne Enterprises' },
  })

  for (const lh of [
    {
      name: 'Lh Head Office',
      is_default: true,
      header_html: '<div data-testid="lh-ho">HEAD OFFICE — invoice for {{ customer }}</div>',
      footer_html: '<div data-testid="lh-ho-foot">Registered No. 12345</div>',
    },
    {
      name: 'Lh Regional',
      is_default: false,
      header_html: '<div data-testid="lh-reg">REGIONAL OFFICE</div>',
      footer_html: '<div data-testid="lh-reg-foot">Regional footer</div>',
    },
  ]) {
    const name = encodeURIComponent(lh.name)
    await request.delete(`/api/resource/Letter%20Head/${name}`, { headers })
    const res = await request.post('/api/save_doc', {
      headers,
      data: { doctype: 'Letter Head', doc: lh },
    })
    if (res.status() !== 201) throw new Error(`letterhead ${lh.name}: ${res.status()}`)
  }
})

test('PRN-004: default letterhead applied, switchable, and suppressible', async ({ page }) => {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/desk/)

  // No choice → the default (Head Office) header/footer appear, interpolated.
  await page.goto(`/print/${encodeURIComponent(DT)}/${docName}`)
  await expect(page.getByTestId('letter-head-header')).toBeVisible()
  await expect(page.getByTestId('lh-ho')).toContainText('HEAD OFFICE — invoice for Wayne Enterprises')
  await expect(page.getByTestId('lh-ho-foot')).toContainText('Registered No. 12345')

  // Choose the regional letterhead → different header, default gone.
  await page.getByTestId('letter-head-picker').selectOption('Lh Regional')
  await expect(page.getByTestId('lh-reg')).toContainText('REGIONAL OFFICE')
  await expect(page.getByTestId('lh-ho')).toHaveCount(0)

  // Suppress it entirely.
  await page.getByTestId('letter-head-picker').selectOption('none')
  await expect(page.getByTestId('letter-head-header')).toHaveCount(0)
  await expect(page.getByTestId('letter-head-footer')).toHaveCount(0)
})
