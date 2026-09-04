import { test, expect, adminAuth, type APIRequestContext } from './fixtures'

// The browser-only half of the checklist surface. The run lifecycle — the
// switcher, ticking, the must-do gate, and a submitted run going final — is a
// component test now (apps/web/test/checklist-binding.test.tsx, #223 batch 1).
// What is left here needs a real browser: a camera upload whose thumbnail the
// server generates and the browser decodes, and the phone-width layout, which
// is a box-model question jsdom has no answer to.
//
// The checklists sample app installs through the real endpoint, exactly like
// the helpdesk spec. Idempotent: an existing structure is left as-is.
async function ensureChecklistStructure(request: APIRequestContext) {
  const H = await adminAuth(request)
  const has = await request.get('/api/table/Checklist%20Run:meta', { headers: H })
  if (has.ok()) return
  const r = await request.post('/api/install_app', {
    headers: H,
    data: { name: 'checklists' },
  })
  if (r.status() !== 201) throw new Error(`install checklists: ${r.status()} ${await r.text()}`)
}

// One run, left open: both tests below need editable controls.
let openRunName = ''

// Seed off the app's fixture template. The template-snapshot hook fills the
// items; the spec only supplies the scope.
test.beforeAll(async ({ request }) => {
  await ensureChecklistStructure(request)
  const H = await adminAuth(request)
  const templates = await request.get(
    '/api/table/Checklist%20Template?fields=%5B%22row_id%22%5D&limit_page_length=1',
    { headers: H },
  )
  const template = ((await templates.json()) as { data: { row_id: string }[] }).data[0]?.row_id
  if (!template) throw new Error('no checklist template — the fixture should have installed one')
  const r = await request.post('/api/save_row', {
    headers: H,
    data: {
      table: 'Checklist Run',
      row: { template, store: 'ATK', section: 'Denim', team_leader: 'E2E TL' },
    },
  })
  if (r.status() !== 201) throw new Error(`seed run: ${r.status()} ${await r.text()}`)
  openRunName = ((await r.json()) as { row_id: string }).row_id
})

test.afterAll(async ({ request }) => {
  const H = await adminAuth(request)
  if (openRunName) await request.delete(`/api/table/Checklist%20Run/${openRunName}`, { headers: H })
})

test('a photo_proof item takes a camera upload and shows its thumbnail', async ({ page }) => {
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
