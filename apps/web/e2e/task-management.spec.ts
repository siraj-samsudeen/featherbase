import { test, expect, ensureRuntimeApp, admitTaskerAdmin } from './fixtures'

test.beforeAll(async ({ request }) => {
  await ensureRuntimeApp(request, 'tasker')
  await admitTaskerAdmin(request)
})

test('tasker_browser_flow: PKG-J1 PKG-R4 capture, project entry, urgency, and focus survive reload', async ({
  session,
}) => {
  await session
    .visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
    .fillIn('Quick capture', 'Review September stock variance')
    .pressKey('Enter')
    .assertText('Review September stock variance')

  await session.step('quick capture keeps focus after adding a task', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Quick capture' })).toBeFocused()
  })

  await session
    .fillIn('Quick capture', 'Confirm warehouse count date')
    .pressKey('Enter')
    .assertText('Confirm warehouse count date')

  await session.step('new tasks retain their capture order', async ({ page }) => {
    await expect(page.locator('article').nth(0)).toContainText('Review September stock variance')
  })

  await session
    .within('button[aria-label="Mark urgent Confirm warehouse count date"]', (button) =>
      button.assertExactText('Not urgent'),
    )
    .clickButton('Mark urgent Confirm warehouse count date')

  await session.step('marking a later task urgent preserves capture order', async ({ page }) => {
    await expect(page.locator('article').nth(0)).toContainText('Review September stock variance')
  })

  await session
    .clickButton('Add to My Focus: Review September stock variance')
    .within('button[aria-label="Remove urgent flag from Confirm warehouse count date"]', (button) =>
      button.assertExactText('Urgent'),
    )
    .selectOption('State for Review September stock variance', 'Blocked')
    .fillIn(
      'Optional explanation',
      'Waiting for the warehouse team to confirm the closing count',
    )
    .clickButton('Save note')
    .assertText('Waiting for the warehouse team')

  await session.step('capture the configured task', async ({ page }) => {
    await page.screenshot({ path: '../../task-management.png', fullPage: true })
  })

  await session
    .clickButton('Projects')
    .fillIn('New project', 'Warehouse review')
    .pressKey('Enter')

  await session.step('creating a project transfers focus to its task input', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Add task to project' })).toBeFocused()
  })

  await session
    .fillIn('Add task to project', 'Compare September closing stock')
    .pressKey('Enter')
    .assertText('Compare September closing stock')
    .within('article:has-text("Compare September closing stock")', (card) =>
      card
        .within('button[aria-label="Mark urgent Compare September closing stock"]', (button) =>
          button.assertExactText('Not urgent'),
        )
        .assertHas('button[aria-label="Add to My Focus: Compare September closing stock"]')
        .assertHas('button', { text: 'Take it', exact: true }),
    )
    .assertValue('Assign Compare September closing stock', '')

  await session.step('focus the filter button', async ({ page }) => {
    await page.locator('.tasker-filter-button').focus()
  })
  await session
    .pressKey('Enter')
    .assertHas('[role="dialog"][aria-label="Filter tasks"]')
  await session.step('the filter sheet starts on the first checkbox', async ({ page }) => {
    await expect(
      page.getByRole('dialog', { name: 'Filter tasks' }).getByRole('checkbox', { name: 'Not started' }),
    ).toBeFocused()
  })
  await session.pressKey('Space').pressKey('Tab').pressKey('Space')
  await session.step('capture the open filter sheet', async ({ page }) => {
    await page.screenshot({ path: '../../task-management-filter-open.png', fullPage: true })
  })
  await session
    .pressKey('Escape')
    .refuteHas('[role="dialog"][aria-label="Filter tasks"]')
  await session.step('closing the filter sheet restores focus to its trigger', async ({ page }) => {
    await expect(page.locator('.tasker-filter-button')).toBeFocused()
  })
  await session.assertHas('button[aria-label="Remove Not started filter"]')
  await session.step('focus the second active filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Remove In progress filter' }).focus()
  })
  await session
    .pressKey('Enter')
    .refuteHas('button[aria-label="Remove In progress filter"]')
    .within('.tasker-match-count', (count) => count.assertAttribute('aria-live', 'polite'))
    .clickButton('Save view')
    .fillIn('View name', 'Open warehouse work')
    .clickButton('Save private view')
    .within('#views-heading', (heading) => heading.assertExactText('Open warehouse work'))
  await session.step('the saved view is reflected in the URL', async ({ page }) => {
    await expect(page).toHaveURL(/#view=/)
  })
  await session.step('capture the saved project view', async ({ page }) => {
    await page.screenshot({ path: '../../task-management-saved-view.png', fullPage: true })
    await page.screenshot({ path: '../../task-management-project.png', fullPage: true })
  })

  await session
    .reload()
    .within('#views-heading', (heading) => heading.assertExactText('Open warehouse work'))
    .assertText('Compare September closing stock')
    .within('.tasker-nav-work', (tab) => tab.click('My Work'))
    .assertText('Review September stock variance')
})

test('tasker_focus_label: Focus identifies the star in both states without changing its accessible name', async ({
  session,
}) => {
  await session
    .visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
    .fillIn('Quick capture', 'Plan the weekly review')
    .pressKey('Enter')
    .assertHas('button.tasker-focus-star[aria-label="Add to My Focus: Plan the weekly review"]', { text: '☆ Focus' })
    .clickButton('Add to My Focus: Plan the weekly review')
    .assertHas('button.tasker-focus-star.is-focused[aria-label="Remove from My Focus: Plan the weekly review"]', { text: '★ Focus' })
    .clickButton('Remove from My Focus: Plan the weekly review')
    .assertHas('button.tasker-focus-star[aria-label="Add to My Focus: Plan the weekly review"]', { text: '☆ Focus' })
})

test('project_rename_conflict: a refetch cannot authorize an older rename', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  const created = await request.post('/api/save_row', {
    headers,
    data: { table: 'tasker.project', row: { project_name: 'Rename conflict project' } },
  })
  expect(created.status()).toBe(201)
  const project = await created.json() as { row_id: string; updated_at: string }

  await session
    .visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
    .clickButton('Rename conflict project')
    .clickButton('Rename')
    .fillIn('Rename project', 'My older rename')

  const competing = await request.post('/api/save_row', {
    headers,
    data: { table: 'tasker.project', row: {
      row_id: project.row_id, updated_at: project.updated_at, project_name: 'Newer shared name',
    } },
  })
  expect(competing.status()).toBe(201)
  expect(await competing.json()).toMatchObject({ project_name: 'Newer shared name' })

  await session
    .fillIn('Add task to project', 'Witness project refresh')
    .pressKey('Enter')
    // The sidebar's new name witnesses the refreshed query reaching React.
    .assertHas('button[aria-label="Newer shared name"]', { text: 'Newer shared name' })
    .assertValue('Rename project', 'My older rename')
    .clickButton('Save')
    .assertHas('[role="alert"]', { text: 'has been modified after you loaded it' })
    .assertValue('Rename project', 'My older rename')

  const persisted = await request.get(`/api/table/tasker.project/${project.row_id}`, { headers })
  expect(persisted.status()).toBe(200)
  expect(await persisted.json()).toMatchObject({ project_name: 'Newer shared name' })
})

test('offline_task_recovery: failed capture retains the draft and failed state changes do not persist', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  const created = await request.post('/api/save_row', {
    headers, data: { table: 'tasker.task', row: { task_title: 'Offline recovery existing count' } },
  })
  expect(created.status()).toBe(201)
  const task = await created.json() as { row_id: string }
  await session.visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox')).assertText('Offline recovery existing count')
  try {
    await session.step('disconnect the browser from the real server', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .fillIn('Quick capture', 'Offline recovery captured 37 cartons')
      .pressKey('Enter')
      .assertHas('[role="alert"]', { text: 'Could not create task' })
      .assertValue('Quick capture', 'Offline recovery captured 37 cartons')
      .selectOption('State for Offline recovery existing count', 'In progress')
      .assertHas('[role="alert"]', { text: 'Could not update task' })
      .assertValue('State for Offline recovery existing count', 'Not started')
    await session.step('reconnect before checking the persisted rows', async ({ page }) => {
      await page.context().setOffline(false)
    })
    expect(await (await request.get(`/api/table/tasker.task/${task.row_id}`, { headers })).json()).toMatchObject({ task_state: 'Not started' })
    const filters = encodeURIComponent(JSON.stringify([['task_title', '=', 'Offline recovery captured 37 cartons']]))
    expect(await (await request.get(`/api/table/tasker.task?filters=${filters}`, { headers })).json()).toMatchObject({ data: [] })
    await session
      .clickButton('Add')
      .assertText('Offline recovery captured 37 cartons')
      .assertValue('Quick capture', '')
      .selectOption('State for Offline recovery existing count', 'In progress')
    await expect.poll(async () => (await (await request.get(`/api/table/tasker.task/${task.row_id}`, { headers })).json()).task_state).toBe('In progress')
    const captured = await (await request.get(`/api/table/tasker.task?filters=${filters}&fields=%5B%22task_title%22%5D`, { headers })).json() as { data: { task_title: string }[] }
    expect(captured.data).toHaveLength(1)
    expect(captured.data[0]).toMatchObject({ task_title: 'Offline recovery captured 37 cartons' })
  } finally {
    await session.step('leave the browser connected', async ({ page }) => {
      await page.context().setOffline(false)
    })
  }
})

test('offline_preference_recovery: private choices roll back until the server can save them', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  for (const [name, settings] of [
    ['tasker.projects', { project_ids: [] }],
    ['tasker.preferences', { mode: 'inspector' }],
    ['tasker.saved-views', { views: [] }],
  ] as const) {
    expect((await request.put(`/api/user_settings/${name}`, { headers, data: settings })).status()).toBe(200)
  }
  const created = await request.post('/api/save_row', {
    headers, data: { table: 'tasker.project', row: { project_name: 'Offline private project' } },
  })
  expect(created.status()).toBe(201)
  const project = await created.json() as { row_id: string }
  expect((await request.post('/api/save_row', {
    headers, data: { table: 'tasker.task', row: { task_title: 'Offline private detail task' } },
  })).status()).toBe(201)
  await session.visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox')).clickButton('Offline private project')
  try {
    await session.step('lose connectivity before starring a project', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .clickButton('☆ Add to tabs')
      .assertHas('[role="alert"]', { text: 'Could not update project tabs' })
      .assertHas('button', { text: '☆ Add to tabs', exact: true })
    await session.step('restore connectivity for the project retry', async ({ page }) => {
      await page.context().setOffline(false)
    })
    expect(await (await request.get('/api/user_settings/tasker.projects', { headers })).json()).toEqual({ settings: { project_ids: [] } })
    await session.clickButton('☆ Add to tabs').assertHas('button', { text: '★ Starred tab', exact: true })
    await expect.poll(async () => (await (await request.get('/api/user_settings/tasker.projects', { headers })).json()).settings).toEqual({ project_ids: [project.row_id] })
    await session
      .within('.tasker-nav-inbox', tab => tab.click('Inbox'))
      .clickLink('Offline private detail task')
      .assertHas('button', { text: 'Edit task', exact: true })
    await session.step('lose connectivity before changing the private detail layout', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .clickButton('Focus')
      .assertHas('[role="alert"]', { text: 'Could not save detail view' })
      .assertHas('aside[aria-label="Task details"]')
      .refuteHas('[role="dialog"][aria-label="Focused task details"]')
    await session.step('restore connectivity for the layout retry', async ({ page }) => {
      await page.context().setOffline(false)
    })
    expect(await (await request.get('/api/user_settings/tasker.preferences', { headers })).json()).toEqual({ settings: { mode: 'inspector' } })
    await session.clickButton('Focus').assertHas('[role="dialog"][aria-label="Focused task details"]')
    await expect.poll(async () => (await (await request.get('/api/user_settings/tasker.preferences', { headers })).json()).settings).toEqual({ mode: 'focus' })
    await session.clickLink('Close').clickButton('Save view').fillIn('View name', 'Offline retained private view')
    await session.step('lose connectivity before saving a named view', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .clickButton('Save private view')
      .assertHas('[role="alert"]', { text: 'Could not save task views' })
      .assertValue('View name', 'Offline retained private view')
    await session.step('restore connectivity for the saved view retry', async ({ page }) => {
      await page.context().setOffline(false)
    })
    expect(await (await request.get('/api/user_settings/tasker.saved-views', { headers })).json()).toEqual({ settings: { views: [] } })
    await session.clickButton('Save private view').within('#views-heading', heading => heading.assertExactText('Offline retained private view'))
    const saved = await (await request.get('/api/user_settings/tasker.saved-views', { headers })).json() as { settings: { views: { name: string; scope: { kind: string } }[] } }
    expect(saved.settings.views).toHaveLength(1)
    expect(saved.settings.views[0]).toMatchObject({ name: 'Offline retained private view', scope: { kind: 'inbox' } })
  } finally {
    await session.step('leave the browser connected', async ({ page }) => {
      await page.context().setOffline(false)
    })
  }
})

test('offline_project_recovery: shared project drafts survive failed writes', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  const created = await request.post('/api/save_row', {
    headers, data: { table: 'tasker.project', row: { project_name: 'Offline rename original' } },
  })
  expect(created.status()).toBe(201)
  const project = await created.json() as { row_id: string }
  await session.visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox')).clickButton('Offline rename original').clickButton('Rename').fillIn('Rename project', 'Offline rename retained')
  try {
    await session.step('disconnect before submitting the shared rename', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .clickButton('Save')
      .assertHas('[role="alert"]', { text: 'Could not rename project' })
      .assertValue('Rename project', 'Offline rename retained')
    await session.step('reconnect before checking the shared project', async ({ page }) => {
      await page.context().setOffline(false)
    })
    expect(await (await request.get(`/api/table/tasker.project/${project.row_id}`, { headers })).json()).toMatchObject({ project_name: 'Offline rename original' })
    await session.clickButton('Save').assertHas('h2', { text: 'Offline rename retained', exact: true })
    expect(await (await request.get(`/api/table/tasker.project/${project.row_id}`, { headers })).json()).toMatchObject({ project_name: 'Offline rename retained' })
    await session.clickButton('Projects').fillIn('New project', 'Offline creation retained')
    await session.step('disconnect before creating another shared project', async ({ page }) => {
      await page.context().setOffline(true)
    })
    await session
      .clickButton('Create project')
      .assertHas('[role="alert"]', { text: 'Could not create project' })
      .assertValue('New project', 'Offline creation retained')
    await session.step('reconnect before checking for an accidental project', async ({ page }) => {
      await page.context().setOffline(false)
    })
    const filters = encodeURIComponent(JSON.stringify([['project_name', '=', 'Offline creation retained']]))
    expect(await (await request.get(`/api/table/tasker.project?filters=${filters}`, { headers })).json()).toMatchObject({ data: [] })
    await session.clickButton('Create project').assertHas('h2', { text: 'Offline creation retained', exact: true })
    const projects = await (await request.get(`/api/table/tasker.project?filters=${filters}&fields=%5B%22project_name%22%5D`, { headers })).json() as { data: { project_name: string }[] }
    expect(projects.data).toHaveLength(1)
    expect(projects.data[0]).toMatchObject({ project_name: 'Offline creation retained' })
  } finally {
    await session.step('leave the browser connected', async ({ page }) => {
      await page.context().setOffline(false)
    })
  }
})

test('tasker_keyboard_progression: ordinary Tab advances within task details and destructive confirmation', async ({ session, request }) => {
  const headers = await ensureRuntimeApp(request, 'tasker')
  expect((await request.put('/api/user_settings/tasker.preferences', { headers, data: { mode: 'focus' } })).status()).toBe(200)
  const created = await request.post('/api/save_row', {
    headers, data: { table: 'tasker.task', row: { task_title: 'Keyboard cancellation count' } },
  })
  expect(created.status()).toBe(201)
  const task = await created.json() as { row_id: string }
  await session.visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox')).clickLink('Keyboard cancellation count').assertHas('[role="dialog"][aria-label="Focused task details"]')
  await session.step('Tab advances from Close rather than wrapping to the last detail control', async ({ page }) => {
    const detail = page.getByRole('dialog', { name: 'Focused task details' })
    await detail.getByRole('link', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(detail.getByRole('button', { name: 'Compact', exact: true })).toBeFocused()
    await detail.getByLabel('More task actions').click()
  })
  await session.clickButton('Delete accidental task').assertHas('[role="alertdialog"][aria-label="Delete accidental task"]')
  await session.step('Tab advances to Delete and Shift Tab returns to Cancel without invoking either action', async ({ page }) => {
    const confirmation = page.getByRole('alertdialog', { name: 'Delete accidental task' })
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(confirmation.getByRole('button', { name: 'Delete permanently' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('More task actions')).toBeFocused()
  })
  await session.refuteHas('[role="alertdialog"]').assertHas('[role="dialog"][aria-label="Focused task details"]')
  expect(await (await request.get(`/api/table/tasker.task/${task.row_id}`, { headers })).json()).toMatchObject({ task_title: 'Keyboard cancellation count', task_state: 'Not started', project: null })
})

test.describe('phone capture', () => {
  test.use({ viewport: { width: 375, height: 720 } })

  test('responsive_workspace_flow: Tasker and its Projects landing have no page-level horizontal overflow', async ({ session }) => {
    await session.visit('/tasker/').within('.tasker-nav-inbox', tab => tab.click('Inbox'))
    await session
      .assertValue('Quick capture', '')
      .clickButton('Filter')
    await session.step('the filter sheet fills the bottom of the mobile viewport', async ({ page }) => {
      const sheet = page.getByRole('dialog', { name: 'Filter tasks' })
      const sheetBox = await sheet.boundingBox()
      expect(sheetBox).not.toBeNull()
      expect(sheetBox!.x).toBe(0)
      expect(sheetBox!.width).toBe(375)
      expect(Math.abs(sheetBox!.y + sheetBox!.height - 720)).toBeLessThanOrEqual(1)
      await page.screenshot({ path: '../../task-management-filter-mobile.png' })
    })
    await session
      .pressKey('Escape')
      .refuteHas('[role="dialog"][aria-label="Filter tasks"]')
      .clickButton('Projects')
      .assertValue('New project', '')
    await session.step('capture the mobile Projects landing', async ({ page }) => {
      await page.screenshot({ path: '../../task-management-mobile.png', fullPage: true })
    })
    await session.assertNoHorizontalOverflow()
  })
})
