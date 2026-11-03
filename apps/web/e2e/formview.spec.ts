import { tableSlug } from 'shared'
import { test, expect, adminAuth } from './fixtures'
import { createFormRow, ensureFormFixtures, FORM_DT as DT } from './fixtures-ui'

let docName = ''

test.beforeAll(async ({ request }) => {
  docName = await ensureFormFixtures(request, await adminAuth(request))
})

// UI-004/UI-005. FormView's fields are addressed by
// `[data-field=...]`, not a `<label>`, so every control check stays a named
// step; `session.visit` still carries the navigation and `assertHas` the
// plain-presence checks the DSL can express.
test('UI-004: FormView renders every field type as the correct control', async ({ session }) => {
  await session
    .visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${docName}`)
    .assertHas('[data-testid="form-view"]')

  await session.step('every column type renders the correct control', async ({ page }) => {
    // Data -> text input with value
    await expect(page.locator('[data-field=title]')).toHaveAttribute('type', 'text')
    await expect(page.locator('[data-field=title]')).toHaveValue('form fixture')
    // Int -> number input
    await expect(page.locator('[data-field=qty]')).toHaveAttribute('type', 'number')
    await expect(page.locator('[data-field=qty]')).toHaveValue('4')
    // Check -> checked checkbox
    await expect(page.locator('[data-field=done]')).toBeChecked()
    // Select -> select with the right option chosen
    await expect(page.locator('select[data-field=stage]')).toHaveValue('Open')
    // Date -> date picker input
    await expect(page.locator('[data-field=due]')).toHaveAttribute('type', 'date')
    await expect(page.locator('[data-field=due]')).toHaveValue('2026-08-01')
    // Link -> combobox input holding the linked name
    await expect(page.locator('[data-field=customer]')).toHaveAttribute('role', 'combobox')
    await expect(page.locator('[data-field=customer]')).toHaveValue('Formco')
    // Text -> textarea
    await expect(page.locator('textarea[data-field=notes]')).toContainText('multi')
    // Table -> child grid with both rows
    const grid = page.getByTestId('table-items')
    await expect(grid.locator('tbody tr')).toHaveCount(2)
    await expect(grid.locator('tbody tr').first().locator('[data-childfield=item]')).toHaveValue('bolt')
  })
})

test('UI-005: save persists edits, shows dirty state and field-wise server errors inline', async ({ session }) => {
  await session
    .visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${docName}`)
    .assertHas('[data-testid="form-status"]', { text: 'Saved' })

  await session.step('form-save starts disabled on a clean document', async ({ page }) => {
    await expect(page.getByTestId('form-save')).toBeDisabled()
  })

  // Edit -> dirty -> save -> persisted
  await session.step('edit the title field directly', async ({ page }) => {
    await page.locator('[data-field=title]').fill('edited via form')
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Not saved' })
  await session.step('save the edit', async ({ page }) => {
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
  await session.step('reload persists the edit', async ({ page }) => {
    await page.reload()
    await expect(page.locator('[data-field=title]')).toHaveValue('edited via form')
  })

  // Server-side field error surfaces inline at the exact field
  await session.step('an over-long title is refused inline at the field', async ({ page }) => {
    await page.locator('[data-field=title]').fill('x'.repeat(150))
    await page.getByTestId('form-save').click()
    await expect(page.getByTestId('error-title')).toBeVisible()
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Not saved' })

  // Fix it and save again
  await session.step('fix the field and save again', async ({ page }) => {
    await page.locator('[data-field=title]').fill('recovered')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
})

// Native browser offline mode rejects fetch itself, rather than returning an
// API error envelope. The independent request fixture still reads the real
// server, so these journeys prove a failed write did not silently commit.
test('offline_save_recovery: an existing row keeps its draft until a connected retry saves it', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const rowId = await createFormRow(request, headers, { title: 'before offline save', qty: 7 })
  const endpoint = `/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(rowId)}`
  const before = await request.get(endpoint, { headers })
  expect(before.status()).toBe(200)
  const original = await before.json()

  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${encodeURIComponent(rowId)}`)
  await session.step('edit the existing row before disconnecting', async ({ page }) => {
    await page.locator('[data-field=title]').fill('offline draft retained')
    await page.locator('[data-field=qty]').fill('19')
  })
  try {
    await session.step('disconnect and submit a real save request', async ({ page }) => {
      await page.context().setOffline(true)
      const failed = page.waitForEvent('requestfailed', {
        predicate: req => req.url().endsWith('/api/save_row') && req.method() === 'POST',
      })
      await page.getByTestId('form-save').click()
      expect((await failed).failure()?.errorText).toContain('ERR_INTERNET_DISCONNECTED')
    })
    await session
      .assertHas('[data-testid="form-banner"]', { text: 'Save failed' })
      .assertHas('[data-testid="form-status"]', { text: 'Not saved' })
    await session.step('the failed save retains editable values and an enabled retry', async ({ page }) => {
      await expect(page.locator('[data-field=title]')).toHaveValue('offline draft retained')
      await expect(page.locator('[data-field=qty]')).toHaveValue('19')
      await expect(page.getByTestId('form-save')).toBeEnabled()
    })
    const unchanged = await request.get(endpoint, { headers })
    expect(unchanged.status()).toBe(200)
    expect(await unchanged.json()).toEqual(original)

    await session.step('reconnect and retry the retained save', async ({ page }) => {
      await page.context().setOffline(false)
      await page.getByTestId('form-save').click()
    })
    await session.assertHas('[data-testid="form-banner"]', { text: 'Saved' })
    const saved = await request.get(endpoint, { headers })
    expect(saved.status()).toBe(200)
    expect(await saved.json()).toMatchObject({ row_id: rowId, title: 'offline draft retained', qty: 19 })
    await session.reload()
    await session.step('the saved draft survives a fresh page load', async ({ page }) => {
      await expect(page.locator('[data-field=title]')).toHaveValue('offline draft retained')
      await expect(page.locator('[data-field=qty]')).toHaveValue('19')
      await expect(page.getByTestId('form-save')).toBeDisabled()
    })
  } finally {
    await session.step('leave the browser connected after save recovery', async ({ page }) => {
      await page.context().setOffline(false)
    })
  }
})

test('offline_row_recovery: rename and delete retain their target and succeed only after reconnecting', async ({ session, request }) => {
  const headers = await adminAuth(request)
  const rowId = await createFormRow(request, headers, {
    row_id: `offline-recovery-${Date.now()}`, title: 'offline rename and delete target', qty: 11,
  })
  const newId = `${rowId}-renamed`
  const endpoint = `/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(rowId)}`
  const renamedEndpoint = `/api/table/${encodeURIComponent(DT)}/${encodeURIComponent(newId)}`
  const before = await request.get(endpoint, { headers })
  expect(before.status()).toBe(200)
  const original = await before.json()

  await session.visit(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${encodeURIComponent(rowId)}`).clickButton('Rename')
  await session.step('enter a new row ID', async ({ page }) => {
    await page.getByTestId('rename-input').fill(newId)
  })
  try {
    await session.step('disconnect and submit the rename through the browser', async ({ page }) => {
      await page.context().setOffline(true)
      const failed = page.waitForEvent('requestfailed', {
        predicate: req => req.url().endsWith(`${endpoint}:rename`) && req.method() === 'POST',
      })
      await page.getByTestId('rename-confirm').click()
      expect((await failed).failure()?.errorText).toContain('ERR_INTERNET_DISCONNECTED')
    })
    await session
      .assertHas('[data-testid="form-banner"]', { text: 'Rename failed' })
      .assertPath(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${encodeURIComponent(rowId)}`)
    await session.step('the rename draft remains available to retry', async ({ page }) => {
      await expect(page.getByTestId('rename-input')).toHaveValue(newId)
      await expect(page.getByTestId('rename-confirm')).toBeEnabled()
    })
    expect(await (await request.get(endpoint, { headers })).json()).toEqual(original)
    expect((await request.get(renamedEndpoint, { headers })).status()).toBe(404)

    await session.step('reconnect and retry the same rename', async ({ page }) => {
      await page.context().setOffline(false)
      await page.getByTestId('rename-confirm').click()
    })
    await session.assertPath(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${encodeURIComponent(newId)}`)
    const renamed = await request.get(renamedEndpoint, { headers })
    expect(renamed.status()).toBe(200)
    const renamedRow = await renamed.json()
    expect(renamedRow).toMatchObject({ row_id: newId, title: original.title, qty: original.qty })
    expect((await request.get(endpoint, { headers })).status()).toBe(404)

    await session.clickButton('Delete').assertHas('[data-testid="delete-row-dialog"]', { text: `Delete ${DT} ${newId}?` })
    await session.step('disconnect and confirm deletion of the renamed row', async ({ page }) => {
      await page.context().setOffline(true)
      const failed = page.waitForEvent('requestfailed', {
        predicate: req => new URL(req.url()).pathname === renamedEndpoint && req.method() === 'DELETE',
      })
      await page.getByTestId('delete-row-confirm').click()
      expect((await failed).failure()?.errorText).toContain('ERR_INTERNET_DISCONNECTED')
    })
    await session
      .assertHas('[data-testid="delete-row-error"]', { text: 'Delete failed' })
      .assertHas('[data-testid="delete-row-dialog"]', { text: `Delete ${DT} ${newId}?` })
      .assertPath(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}/row/${encodeURIComponent(newId)}`)
    await session.step('the failed delete can be retried without losing its target', async ({ page }) => {
      await expect(page.getByTestId('delete-row-confirm')).toBeEnabled()
      await expect(page.locator('[data-field=title]')).toHaveValue(original.title)
    })
    expect(await (await request.get(renamedEndpoint, { headers })).json()).toEqual(renamedRow)

    await session.step('reconnect and retry deletion from the same confirmation', async ({ page }) => {
      await page.context().setOffline(false)
      await page.getByTestId('delete-row-confirm').click()
    })
    await session.assertPath(`/featherbase/admin/table/${encodeURIComponent(tableSlug(DT))}`)
    expect((await request.get(renamedEndpoint, { headers })).status()).toBe(404)
    expect((await request.get(endpoint, { headers })).status()).toBe(404)
  } finally {
    await session.step('leave the browser connected after row recovery', async ({ page }) => {
      await page.context().setOffline(false)
    })
  }
})
