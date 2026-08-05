import { expect, test, type APIRequestContext } from '@playwright/test'

const ADMIN_PWD = process.env.ADMIN_PASSWORD ?? 'admin'

async function token(request: APIRequestContext) {
  const r = await request.post('/api/login', {
    data: { usr: 'Administrator', pwd: ADMIN_PWD },
  })
  return ((await r.json()) as { token: string }).token
}

// The checklists sample app installs through the real endpoint, exactly like
// the helpdesk spec. Idempotent: an existing structure is left as-is.
async function ensureChecklistStructure(request: APIRequestContext) {
  const H = { Authorization: `Bearer ${await token(request)}` }
  const has = await request.get('/api/table/Checklist%20Run:meta', { headers: H })
  if (has.ok()) return
  const r = await request.post('/api/install_app', {
    headers: H,
    data: { name: 'checklists' },
  })
  if (r.status() !== 201) throw new Error(`install checklists: ${r.status()} ${await r.text()}`)
}

// TWO runs: the first spec submits its run, and a submitted run is final —
// its controls are gone — so the photo and mobile specs get their own, opened
// by name rather than by "whichever card sorts first".
let runName = ''
let openRunName = ''

// Seed off the app's fixture template. The template-snapshot hook fills the
// items; the spec only supplies the scope.
test.beforeAll(async ({ request }) => {
  await ensureChecklistStructure(request)
  const H = { Authorization: `Bearer ${await token(request)}` }
  const templates = await request.get(
    '/api/table/Checklist%20Template?fields=%5B%22name%22%5D&limit_page_length=1',
    { headers: H },
  )
  const template = ((await templates.json()) as { data: { name: string }[] }).data[0]?.name
  if (!template) throw new Error('no checklist template — the fixture should have installed one')
  const seed = async (section: string) => {
    const r = await request.post('/api/save_doc', {
      headers: H,
      data: {
        doctype: 'Checklist Run',
        doc: { template, store: 'ATK', section, team_leader: 'E2E TL' },
      },
    })
    if (r.status() !== 201) throw new Error(`seed run: ${r.status()} ${await r.text()}`)
    return ((await r.json()) as { name: string }).name
  }
  runName = await seed('Kurti')
  openRunName = await seed('Denim')
})

test.afterAll(async ({ request }) => {
  const H = { Authorization: `Bearer ${await token(request)}` }
  for (const name of [runName, openRunName])
    if (name) await request.delete(`/api/table/Checklist%20Run/${name}`, { headers: H })
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name=email]', 'Administrator')
  await page.fill('input[name=password]', ADMIN_PWD)
  await page.click('button[type=submit]')
  await expect(page).toHaveURL(/\/admin/)
}

test('checklist view: list → run → tick → submit gate → submit', async ({ page }) => {
  await login(page)

  // The switcher appears on the run list because the Table has checklist
  // shape — and is absent from a Table that lacks it.
  await page.goto('/admin/Checklist%20Run')
  await page.getByTestId('open-checklist').click()
  await expect(page.getByTestId('checklist-view')).toBeVisible()

  // Open the seeded run from its date-grouped card.
  await page.getByTestId('checklist-run-card').filter({ hasText: 'Kurti' }).first().click()
  await expect(page.getByTestId('checklist-run-view')).toBeVisible()
  await expect(page.getByTestId('checklist-item')).toHaveCount(8)
  await expect(page.getByTestId('checklist-progress')).toHaveText('0/8')

  // Tap-to-tick: the row saves immediately, progress and the stamp follow.
  await page.getByTestId('checklist-item').first().getByRole('checkbox').click()
  await expect(page.getByTestId('checklist-progress')).toHaveText('1/8')
  await expect(page.getByTestId('checklist-item').first()).toContainText('✓')

  // Submit while must-do items are open: the server-side gate refuses and
  // its message surfaces verbatim.
  await page.getByTestId('checklist-submit').click()
  await expect(page.getByTestId('checklist-error')).toContainText('must-do')

  // Tick the remaining must-do items (indexes 1, 2, 5, 7 of the fixture;
  // 0 is already done), then submit for real.
  for (const i of [1, 2, 5, 7]) {
    await page.getByTestId('checklist-item').nth(i).getByRole('checkbox').click()
    await expect(page.getByTestId('checklist-progress')).toHaveText(`${[1, 2, 5, 7].indexOf(i) + 2}/8`)
  }
  await page.getByTestId('checklist-submit').click()
  await expect(page.getByText(`${runName} · Submitted`)).toBeVisible()

  // A submitted run is final: the surface says so and stops offering edits,
  // matching the server, which refuses every later write.
  await expect(page.getByTestId('checklist-locked')).toBeVisible()
  await expect(page.getByTestId('checklist-item').first().getByRole('checkbox')).toBeDisabled()
  await expect(page.getByTestId('checklist-submit')).toHaveCount(0)
  await expect(page.getByTestId('checklist-photo-add')).toHaveCount(0)
  await expect(page.getByTestId('checklist-add-note')).toHaveCount(0)
})

test('a photo_proof item takes a camera upload and shows its thumbnail', async ({ page }) => {
  await login(page)
  await page.goto(`/admin/Checklist%20Run/view/checklist?run=${openRunName}`)
  await expect(page.getByTestId('checklist-run-view')).toBeVisible()

  // A real 1×1 PNG so the server generates a thumbnail data URI.
  await page.getByTestId('checklist-photo-input').first().setInputFiles({
    name: 'fast-mover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  })
  await expect(page.getByTestId('checklist-photo-thumb').first()).toBeVisible()

  // Tapping the thumbnail opens the full-screen viewer with the real image.
  await page.getByTestId('checklist-photo-thumb').first().click()
  await expect(page.getByTestId('checklist-photo-view')).toBeVisible()
  await expect(page.getByTestId('checklist-photo-view').locator('img')).toBeVisible()
  await page.getByRole('button', { name: 'Close photo' }).click()
  await expect(page.getByTestId('checklist-photo-view')).not.toBeVisible()
})

test.describe('mobile width', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('the run list and items stay usable at phone width', async ({ page }) => {
    await login(page)
    await page.goto('/admin/Checklist%20Run/view/checklist')
    await expect(page.getByTestId('checklist-view')).toBeVisible()
    await page.goto(`/admin/Checklist%20Run/view/checklist?run=${openRunName}`)
    await expect(page.getByTestId('checklist-run-view')).toBeVisible()
    // No horizontal overflow, and the tap target is comfortably tall.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    const box = await page.getByTestId('checklist-item').first().boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
})
