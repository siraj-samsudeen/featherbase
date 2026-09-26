import { anonymousTest as test, expect, adminAuth, ADMIN_PWD, waitForRealtime, type Page } from './fixtures'
import { ensureTable } from './fixtures-ui'

const table = 'Responsive row editor'
const name = 'Stock-review-with-a-long-unbroken-identifier-3783'
const url = `/api/table/${encodeURIComponent(table)}/${name}`
const fileName = `stock-review-${'x'.repeat(70)}.txt`

test.beforeAll(async ({ request }) => {
  const headers = await adminAuth(request)
  await ensureTable(request, headers, {
    name: table, id_pattern: 'prompt',
    columns: [
      { column_name: 'title', column_type: 'Data', label: 'Title', reqd: true },
      { column_name: 'qty', column_type: 'Int', label: 'Cartons' },
      { column_name: 'notes', column_type: 'Text', label: 'Notes' },
    ],
  })
  const created = await request.post(`/api/table/${encodeURIComponent(table)}`, {
    headers, data: { row_id: name, title: 'Southern 37 cartons', qty: 83, notes: 'Keep **this** description' },
  })
  expect([201, 409]).toContain(created.status())
})

async function contained(page: Page, selectors: string[]) {
  if (page.viewportSize()!.width === 375) {
    // Live resize animates the existing closed drawer; capture its settled
    // state, without hiding it or accepting an overlay over the form.
    await expect.poll(() => page.getByTestId('admin-sidebar').evaluate(e => e.getBoundingClientRect().right)).toBeLessThanOrEqual(0)
  }
  for (const selector of selectors) {
    for (const element of await page.locator(selector).all()) {
      if (!await element.isVisible()) continue
      const box = await element.boundingBox()
      expect(box, selector).not.toBeNull()
      expect(box!.x, `${selector} left`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${selector} right`).toBeLessThanOrEqual(page.viewportSize()!.width)
    }
  }
  expect(await page.locator('main').evaluate(e => e.scrollWidth <= e.clientWidth), 'canvas overflow').toBe(true)
}

const controls = ['[data-testid=breadcrumbs]', 'h1', '[data-field]', '[data-testid=form-save]',
  '[data-testid=form-status]', '[data-testid=form-banner]', '[data-testid=stale-banner]',
  '[data-testid=error-title]', '[data-testid=attach-error]', '[data-testid=attach-file]',
  '[data-testid=attachment-row] a', '[data-testid=attachment-delete]']

// Migrated to the feather-testing-core DSL (docs/testing/e2e-dsl-migration.md).
// Every check here is a bounding-box/CSS/attribute probe, a screenshot, or a
// route stub — none of which has a Session verb — so the body stays the
// original imperative Playwright, reorganized into named steps around
// `session.visit`/`session.fillIn` for the parts the DSL does reach (the
// label-friendly login form, page navigation).
for (const width of [375, 1440]) {
  test(`core form and attachments remain reachable at ${width}px`, async ({ session, request }) => {
    await session.step(`set the viewport to ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 })
    })
    await session
      .visit('/featherbase/login')
      .fillIn('Email or username', 'Administrator')
      .fillIn('Password', ADMIN_PWD)
      .clickButton('Sign in')
      .assertHas('[data-testid="session-user"]')

    await session.visit(`/featherbase/admin/${encodeURIComponent(table)}/new`).assertHas('[data-testid="form-view"]')
    await session.step('the blank form stays fully contained', async ({ page }) => {
      await contained(page, controls)
      await page.screenshot({ path: `../../dist/core-responsive-${width}-blank.png` })
    })

    await session.visit(`/featherbase/admin/${encodeURIComponent(table)}/${name}`)
    await session.step('an external save while open shows the stale banner, contained', async ({ page }) => {
      await expect(page.locator('[data-field=title]')).toBeVisible()
      const headers = await adminAuth(request)
      await waitForRealtime(page, `row:${table}:${name}`)
      const prior = await (await request.get(url, { headers })).json()
      const external = await request.post('/api/save_row', { headers, data: { table, row: { ...prior, title: 'Other session 83 crates' } } })
      expect(external.status()).toBe(201)
      await expect(page.getByTestId('stale-banner')).toBeVisible()
      await contained(page, controls)
      await page.screenshot({ path: `../../dist/core-responsive-${width}-stale.png` })
    })

    await session.step('refresh the stale row and save the edit', async ({ page }) => {
      await page.getByTestId('stale-refresh').click()
      await expect(page.locator('[data-field=title]')).toHaveValue('Other session 83 crates')
      await page.locator('[data-field=title]').fill(`Northern ${width} crates`)
      await page.getByTestId('form-save').focus()
      await contained(page, controls)
      await page.getByTestId('form-save').press('Enter')
      await expect(page.getByTestId('form-banner')).toHaveText('Saved')
      const headers = await adminAuth(request)
      expect(await (await request.get(url, { headers })).json()).toMatchObject({ title: `Northern ${width} crates`, qty: '83', notes: 'Keep **this** description' })
    })

    await session.step('the attachments sidebar sits beside/below the form section by breakpoint', async ({ page }) => {
      const sections = page.getByTestId('form-section-0')
      const sidebar = page.getByTestId('attachments-panel').locator('..')
      const sectionBox = (await sections.boundingBox())!
      const sideBox = (await sidebar.boundingBox())!
      if (width === 1440) expect(sideBox.x).toBeGreaterThan(sectionBox.x + sectionBox.width)
      else expect(sideBox.y).toBeGreaterThan(sectionBox.y + sectionBox.height)
    })

    await session.step('an overlong title surfaces the validation error, contained', async ({ page }) => {
      await page.locator('[data-field=title]').fill('x'.repeat(150))
      await page.getByTestId('form-save').click()
      await expect(page.getByTestId('error-title')).toBeVisible()
      await contained(page, controls)
      await page.screenshot({ path: `../../dist/core-responsive-${width}-validation.png` })
      await page.locator('[data-field=title]').fill('Unsaved 37, not 83')
    })

    // Presentation probes only: real pending/obsolete admission is covered by
    // runtime-client-identity.test and the separately built package journey.
    for (const [status, message] of [[403, 'Application pending activation; contact an administrator.'], [409, 'Application version changed; reload before saving.']] as const) {
      await session.step(`a ${status} save/upload error renders the banner and stays contained`, async ({ page }) => {
        await page.route('**/api/save_row', route => route.fulfill({ status, json: { error: { type: 'PermissionError', message } } }))
        let releaseUpload!: () => void
        const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve })
        await page.route('**/api/upload_file', async route => {
          await uploadGate
          await route.fulfill({ status, json: { error: { type: 'PermissionError', message } } })
        })
        await page.getByTestId('form-save').click()
        await expect(page.getByTestId('form-banner')).toHaveText(message)
        await expect(page.locator('[data-field=title]')).toHaveValue('Unsaved 37, not 83')
        await expect(page.getByTestId('form-status')).toHaveText('Not saved')
        await page.getByTestId('attach-file-input').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('37 cartons, not 83') })
        try {
          await expect(page.getByTestId('attach-file')).toHaveText('Uploading…')
          await expect(page.getByTestId('attach-file')).toBeDisabled()
          await contained(page, controls)
        } finally {
          releaseUpload()
        }
        await expect(page.getByTestId('attach-error')).toHaveText(message)
        await contained(page, controls)
        await page.getByTestId('attach-error').scrollIntoViewIfNeeded()
        await page.screenshot({ path: `../../dist/core-responsive-${width}-${status}.png` })
        await page.unroute('**/api/save_row')
        await page.unroute('**/api/upload_file')
      })
    }

    await session.step('a real attachment uploads, is downloadable, and stays contained', async ({ page }) => {
      await page.getByTestId('attach-file-input').setInputFiles({ name: fileName, mimeType: 'text/plain', buffer: Buffer.from('37 cartons, not 83') })
      const attachment = page.getByTestId('attachment-row').filter({ hasText: fileName })
      await expect(attachment).toBeVisible()
      const href = (await attachment.locator('a').getAttribute('href'))!
      expect(await (await page.request.get(href)).text()).toBe('37 cartons, not 83')
      await page.mouse.move(0, 0)
      const remove = attachment.getByTestId('attachment-delete')
      await expect(remove).toHaveCSS('opacity', '1')
      await attachment.locator('a').focus()
      await page.keyboard.press('Tab')
      await expect(remove).toBeFocused()
      await expect(remove).toHaveCSS('outline-width', '2px')
      await contained(page, controls)
      await page.screenshot({ path: `../../dist/core-responsive-${width}-attachment.png` })
      if (width === 1440) {
        await page.setViewportSize({ width: 375, height: 1000 })
        await contained(page, controls)
        await page.getByTestId('form-save').focus()
        await contained(page, controls)
        await page.screenshot({ path: '../../dist/core-responsive-resized-375.png' })
      }
      await remove.focus()
      await remove.press('Enter')
      await expect(attachment).toHaveCount(0)
      expect((await page.request.get(href)).status()).toBe(404)
    })
  })
}
