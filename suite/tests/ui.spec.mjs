import { test, expect } from '../fixtures.mjs';
import { add, rename, save, remove, filter, item, editor, list, conflict, draftRetained, layout, accessible, associatedError, tabTo } from '../lib/ui.mjs';
import { inject } from '../lib/faults.mjs';

test('Create/edit/filter lifecycle and independent-session persistence @core', async ({ app, page, browser }, info) => {
  const sentinel = await app.api.create('Untouched');
  await page.goto(app.baseURL);
  await expect(page.getByRole('group', { name: 'Filter todos', exact: true }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await add(page, '  Buy  milk  ');
  await expect(item(page, 'Buy  milk')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toHaveValue('');
  const original = (await app.api.list()).find(r => r.title === 'Buy  milk');
  await rename(page, 'Buy  milk', 'Discarded');
  await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await app.api.read(original.id)).toMatchObject({ title: 'Buy  milk' });
  await rename(page, 'Buy  milk', 'Buy oat milk');
  await save(page);
  await expect(item(page, 'Buy oat milk')).toBeVisible();
  await item(page, 'Buy oat milk').getByRole('checkbox', { name: 'Completed', exact: true }).check();
  await expect.poll(async () => (await app.api.read(original.id)).completed).toBe(true);
  await filter(page, 'Open');
  await expect(item(page, 'Buy oat milk')).toHaveCount(0);
  await expect(item(page, 'Untouched')).toBeVisible();
  await filter(page, 'Completed');
  await expect(item(page, 'Buy oat milk')).toBeVisible();
  await expect(item(page, 'Untouched')).toHaveCount(0);
  const completed = item(page, 'Buy oat milk').getByRole('checkbox', { name: 'Completed', exact: true });
  await expect(completed).toBeChecked();
  // The record correctly disappears from this filter after reopening. Do not ask
  // uncheck() to re-resolve that now-absent control for its post-click assertion.
  await completed.click();
  await expect.poll(async () => (await app.api.read(original.id)).completed).toBe(false);
  await expect(list(page)).toContainText('No completed todos');
  await filter(page, 'All');
  await page.reload();
  await expect(item(page, 'Buy oat milk')).toBeVisible();
  const second = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const other = await second.newPage();
    await other.goto(app.baseURL);
    await expect(item(other, 'Buy oat milk')).toBeVisible();
  } finally { await second.close(); }
  if (info.project.name === 'chromium-desktop') await page.screenshot({ path: 'suite-results/desktop-list.png', fullPage: true });
  await remove(page, 'Buy oat milk');
  await expect(item(page, 'Buy oat milk')).toHaveCount(0);
  expect(await app.api.read(sentinel.id)).toEqual(sentinel);
  expect(await app.api.snapshot()).toEqual([{ id: sentinel.id, title: 'Untouched', completed: false }]);
});

test('Duplicates and all empty states', async ({ app, page }) => {
  await page.goto(app.baseURL);
  await expect(list(page)).toContainText('No todos');
  await filter(page, 'Open');
  await expect(list(page)).toContainText('No open todos');
  await filter(page, 'Completed');
  await expect(list(page)).toContainText('No completed todos');
  await filter(page, 'All');
  await add(page, 'Same');
  await expect(item(page, 'Same')).toHaveCount(1);
  await add(page, 'Same');
  await expect(item(page, 'Same')).toHaveCount(2);
  const before = await app.api.list();
  await item(page, 'Same').first().getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete todo', exact: true });
  await expect.poll(async () => await confirmation.isVisible() || await item(page, 'Same').count() === 1).toBe(true);
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await expect(item(page, 'Same')).toHaveCount(1);
  const after = await app.api.list();
  expect(after).toHaveLength(1);
  expect(before.map(r => r.id)).toContain(after[0].id);
});

test('Browser validation retains invalid input; Unicode and literal markup', async ({ app, page }) => {
  const sentinel = await app.api.create('Original');
  let dialogs = 0;
  page.on('dialog', dialog => { dialogs++; void dialog.dismiss(); });
  await page.goto(app.baseURL);
  for (const title of ['x', '😀'.repeat(200), 'e\u0301 MiXeD', '<script>alert(1)</script>', '<img src=x onerror=alert(1)>']) {
    await add(page, title);
    await expect(item(page, title)).toBeVisible();
    expect((await app.api.list()).find(r => r.title === title)).toBeTruthy();
  }
  for (const title of ['   ', '😀'.repeat(201)]) {
    const before = await app.api.snapshot();
    await add(page, title);
    await expect(page.getByRole('alert')).toBeVisible();
    const input = page.getByRole('textbox', { name: 'New todo', exact: true });
    await expect(input).toHaveValue(title);
    await associatedError(input);
    expect(await app.api.snapshot()).toEqual(before);
  }
  await rename(page, 'Original', 'a'.repeat(201));
  await save(page);
  await draftRetained(page, 'a'.repeat(201));
  await associatedError(editor(page).getByRole('textbox', { name: 'Todo title', exact: true }));
  expect(await app.api.read(sentinel.id)).toEqual(sentinel);
  expect(dialogs).toBe(0);
});

test('Repeated activation while pending creates exactly one', async ({ app, page, context }, info) => {
  await page.goto(app.baseURL);
  const fault = await inject(context, r => app.api.matches('create', r), 'hold');
  try {
    await add(page, 'Once');
    await fault.observed;
    await expect(page.getByRole('status')).toContainText(/\S/);
    await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toHaveValue('Once');
    const button = page.getByRole('button', { name: 'Add todo', exact: true });
    if (await button.isEnabled()) { await button.click(); await button.press('Enter'); }
    fault.release();
    await expect(item(page, 'Once')).toHaveCount(1);
    await expect.poll(async () => (await app.api.list()).length).toBe(1);
    await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
  } finally { await fault.close(); }
});

for (const mode of ['abort', 'lost-response']) {
  test(`Create recovery: ${mode} @core`, async ({ app, page, context }, info) => {
    const sentinel = await app.api.create('Untouched');
    await page.goto(app.baseURL);
    const fault = await inject(context, r => app.api.matches('create', r), mode);
    try {
      await add(page, 'Retained draft');
      await fault.observed;
      await expect(page.getByRole('alert')).toBeVisible();
      if (mode === 'abort') {
        await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toHaveValue('Retained draft');
        expect(await app.api.snapshot()).toEqual([{ id: sentinel.id, title: 'Untouched', completed: false }]);
      } else {
        expect((await app.api.list()).filter(r => r.title === 'Retained draft')).toHaveLength(1);
      }
      const check = page.getByRole('button', { name: 'Check status', exact: true });
      const retry = page.getByRole('button', { name: 'Retry', exact: true });
      if (mode === 'lost-response') await check.click();
      else {
        // A transport failure does not tell the browser whether the server received the write.
        await expect(check.or(retry).first()).toBeVisible();
        if (await check.isVisible()) {
          await check.click();
          await expect(retry).toBeVisible();
        }
        await retry.click();
      }
      await expect(item(page, 'Retained draft')).toHaveCount(1);
      expect((await app.api.list()).filter(r => r.title === 'Retained draft')).toHaveLength(1);
      expect(await app.api.read(sentinel.id)).toEqual(sentinel);
      await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
    } finally { await fault.close(); }
  });
}

test('Uncertain creation cannot discard a newly entered title', async ({ app, page, context }, info) => {
  await page.goto(app.baseURL);
  const fault = await inject(context, r => app.api.matches('create', r), 'lost-response');
  try {
    await add(page, 'First intended todo');
    await fault.observed;
    const check = page.getByRole('button', { name: 'Check status', exact: true });
    await expect(check).toBeVisible();
    const input = page.getByRole('textbox', { name: 'New todo', exact: true });
    const submit = page.getByRole('button', { name: 'Add todo', exact: true });
    const acceptsNewDraft = await input.isEditable();
    if (acceptsNewDraft) {
      await input.fill('Second entered todo');
      if (await submit.isEnabled()) await submit.click();
      else await check.click();
      // A new draft may stay editable or be deliberately saved as a distinct
      // Todo, but must not be erased by recovery of the previous submission.
      await expect.poll(async () => {
        const records = await app.api.list();
        return (await input.inputValue()) === 'Second entered todo'
          || records.some(record => record.title === 'Second entered todo');
      }).toBe(true);
      await expect(page.getByRole('status')).not.toContainText(/saving|checking/i);
      const records = await app.api.list();
      expect((await input.inputValue()) === 'Second entered todo'
        || records.some(record => record.title === 'Second entered todo')).toBe(true);
    } else {
      await expect(input).toHaveValue('First intended todo');
      await check.click();
      await expect(input).toBeEditable();
      await expect(item(page, 'First intended todo')).toHaveCount(1);
    }
    // Accepting another draft must not lose the earlier request's recovery
    // identity or leave Check status inert. Resolve it without a page reload.
    if (await check.isVisible()) await check.click();
    await expect(item(page, 'First intended todo')).toHaveCount(1);
    if (acceptsNewDraft) {
      const records = await app.api.list();
      expect((await input.inputValue()) === 'Second entered todo'
        || records.some(record => record.title === 'Second entered todo')).toBe(true);
    }
    expect((await app.api.list()).filter(record => record.title === 'First intended todo')).toHaveLength(1);
    await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
  } finally { await fault.close(); }
});

for (const outcome of ['success', 'lost-response']) {
  test(`Uncertain creation survives another Todo's ${outcome}`, async ({ app, page, context }, info) => {
    const existing = await app.api.create('Existing independent todo');
    await page.goto(app.baseURL);
    await expect(item(page, existing.title)).toBeVisible();
    const fault = await inject(context, r => app.api.matches('create', r), 'lost-response');
    let mutationFault;
    try {
      await add(page, 'First uncertain todo');
      await fault.observed;
      await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
      expect((await app.api.list()).filter(record => record.title === 'First uncertain todo')).toHaveLength(1);
      const check = page.getByRole('button', { name: 'Check status', exact: true });
      await expect(check).toBeVisible();
      const checkbox = item(page, existing.title).getByRole('checkbox', { name: 'Completed', exact: true });
      const permitsOtherAction = await checkbox.isEnabled();
      if (permitsOtherAction) {
        if (outcome === 'lost-response') mutationFault = await inject(context, r => app.api.matches('complete', r), 'lost-response');
        await checkbox.click();
        if (mutationFault) {
          await mutationFault.observed;
          await info.attach('mutation-injection', { body: JSON.stringify(mutationFault.verify()), contentType: 'application/json' });
        }
        await expect.poll(async () => (await app.api.read(existing.id)).completed).toBe(true);
        await expect(checkbox).toBeEnabled();
      }
      // Blocking unrelated actions, preserving Check status, or automatically
      // reconciling the save are valid. Losing both the save and its recovery is not.
      if (await check.isVisible()) await check.click();
      await expect(item(page, 'First uncertain todo')).toHaveCount(1);
      await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toBeEditable();
      await add(page, 'Second independent todo');
      await expect(item(page, 'Second independent todo')).toHaveCount(1);
      const records = await app.api.list();
      expect(records.map(record => record.title).sort()).toEqual(['Existing independent todo', 'First uncertain todo', 'Second independent todo']);
      expect((await app.api.read(existing.id)).completed).toBe(permitsOtherAction);
    } finally { if (mutationFault) await mutationFault.close(); await fault.close(); }
  });
}

test('Keyboard deletion preserves focus while creation is uncertain', async ({ app, page, context }, info) => {
  const existing = await app.api.create('Existing deletion target');
  await page.goto(app.baseURL);
  await expect(item(page, existing.title)).toBeVisible();
  const fault = await inject(context, r => app.api.matches('create', r), 'lost-response');
  try {
    await add(page, 'First uncertain todo');
    await fault.observed;
    await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
    const check = page.getByRole('button', { name: 'Check status', exact: true });
    await expect(check).toBeVisible();
    const remove = item(page, existing.title).getByRole('button', { name: 'Delete', exact: true });
    // Blocking deletion until reconciliation is a valid alternative.
    if (await remove.isDisabled()) await check.click();
    await tabTo(page, remove);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Delete todo', exact: true });
    await expect.poll(async () => await dialog.isVisible() || await item(page, existing.title).count() === 0).toBe(true);
    if (await dialog.isVisible()) {
      await tabTo(page, dialog.getByRole('button', { name: 'Confirm delete', exact: true }));
      await page.keyboard.press('Enter');
    }
    await expect(item(page, existing.title)).toHaveCount(0);
    // Allow the normal post-render focus step; persistent body/disabled focus fails.
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body
      && document.activeElement?.isConnected && !document.activeElement.matches(':disabled')), { timeout: 1000 }).toBe(true);
    if (await check.isVisible()) await check.click();
    await expect(item(page, 'First uncertain todo')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toBeEditable();
    expect((await app.api.list()).map(record => record.title)).toEqual(['First uncertain todo']);
    app.api.error(await app.api.call('read', existing), 'missing');
  } finally { await fault.close(); }
});

test('Failed read is not an empty state and retries without reload', async ({ app, page, context, database }, info) => {
  await app.api.create('Still saved');
  const serverRead = app.config.http.serverRenderedRead === true;
  const fault = serverRead ? null : await inject(context, r => app.api.matches('list', r));
  try {
    if (serverRead) {
      await database.outage(true);
      await expect(database.query('SELECT 1')).rejects.toMatchObject({ code: '28000' });
    }
    await page.goto(app.baseURL);
    if (fault) await fault.observed;
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(list(page)).not.toContainText('No todos');
    if (serverRead) await database.outage(false);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(item(page, 'Still saved')).toBeVisible();
    await info.attach('injection', { body: JSON.stringify(fault ? fault.verify() : { mode: 'database-login-denied', sqlstate: '28000' }), contentType: 'application/json' });
  } finally { if (fault) await fault.close(); if (serverRead) await database.outage(false); }
});

for (const operation of ['rename', 'complete', 'reopen', 'delete']) {
  test(`Failed ${operation} preserves confirmed state and retries`, async ({ app, page, context }, info) => {
    let target = await app.api.create('Original');
    if (operation === 'reopen') target = await app.api.change('complete', target, { completed: true });
    const before = await app.api.snapshot();
    await page.goto(app.baseURL);
    const fault = await inject(context, r => app.api.matches(operation === 'reopen' ? 'complete' : operation, r));
    try {
      if (operation === 'rename') { await rename(page, 'Original', 'Kept draft'); await save(page); }
      else if (operation === 'delete') await remove(page, 'Original');
      else await item(page, 'Original').getByRole('checkbox', { name: 'Completed', exact: true }).click();
      await fault.observed;
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await app.api.snapshot()).toEqual(before);
      if (operation === 'rename') await draftRetained(page, 'Kept draft');
      else await expect(item(page, 'Original').getByRole('checkbox', { name: 'Completed', exact: true })).toBeChecked({ checked: target.completed });
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect.poll(async () => await app.api.snapshot()).toEqual(operation === 'delete' ? [] : [{ id: target.id, title: operation === 'rename' ? 'Kept draft' : 'Original', completed: operation === 'rename' ? target.completed : operation !== 'reopen' }]);
      await info.attach('injection', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
    } finally { await fault.close(); }
  });
}

for (const operation of ['rename', 'complete', 'reopen', 'delete']) {
  test(`Two independent contexts reject stale ${operation} @core`, async ({ app, page, browser }, info) => {
    let target = await app.api.create('Original');
    if (operation === 'reopen') target = await app.api.change('complete', target, { completed: true });
    const second = await browser.newContext({ serviceWorkers: 'block', viewport: page.viewportSize() });
    const fault = await inject(second, r => app.api.matches(operation === 'reopen' ? 'complete' : operation, r), 'hold');
    try {
      const other = await second.newPage();
      await Promise.all([page.goto(app.baseURL), other.goto(app.baseURL)]);
      // Hold B's already-formed request; even live updates cannot refresh its observation.
      if (operation === 'rename') await rename(other, 'Original', 'My retained draft');
      const pending = operation === 'rename' ? save(other) : operation === 'delete' ? remove(other, 'Original') : item(other, 'Original').getByRole('checkbox', { name: 'Completed', exact: true }).click();
      await fault.observed;
      await rename(page, 'Original', 'Latest');
      await save(page);
      await expect(item(page, 'Latest')).toBeVisible();
      fault.release();
      await pending;
      await conflict(other, operation === 'rename' ? 'My retained draft' : undefined);
      expect(await app.api.read(target.id)).toMatchObject({ title: 'Latest', completed: target.completed });
      if (operation === 'rename' && info.project.name === 'chromium-desktop') await other.screenshot({ path: 'suite-results/conflict-draft.png', fullPage: true });
      await other.getByRole('button', { name: 'Review latest', exact: true }).click();
      if (operation === 'rename') {
        await draftRetained(other, 'My retained draft');
        await save(other);
        await expect.poll(async () => (await app.api.read(target.id)).title).toBe('My retained draft');
      }
      await info.attach('interleaving', { body: JSON.stringify(fault.verify()), contentType: 'application/json' });
    } finally { await fault.close(); await second.close(); }
  });
}

test('Deleted elsewhere preserves draft and never resurrects', async ({ app, page, browser }) => {
  const target = await app.api.create('Original');
  const sentinel = await app.api.create('Untouched');
  const second = await browser.newContext({ serviceWorkers: 'block' });
  const fault = await inject(second, r => app.api.matches('rename', r), 'hold');
  try {
    const other = await second.newPage();
    await Promise.all([page.goto(app.baseURL), other.goto(app.baseURL)]);
    await rename(other, 'Original', 'Recoverable draft');
    const pending = save(other);
    await fault.observed;
    await remove(page, 'Original');
    await expect(item(page, 'Original')).toHaveCount(0);
    fault.release();
    await pending;
    await expect(other.getByRole('alert')).toContainText('Todo no longer exists');
    await draftRetained(other, 'Recoverable draft');
    expect(await app.api.snapshot()).toEqual([{ id: sentinel.id, title: 'Untouched', completed: false }]);
    app.api.error(await app.api.call('read', target), 'missing');
    await editor(other).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(item(other, 'Original')).toHaveCount(0);
    fault.verify();
  } finally { await fault.close(); await second.close(); }
});

test('Long-title layout, 320px, 1440px and 200% text enlargement @core', async ({ app, page }, info) => {
  const title = 'Long 😀 '.repeat(25).trim(); // 174 code points, with wrapping and astral characters.
  await app.api.create(title);
  await app.api.create('W'.repeat(200));
  await page.goto(app.baseURL);
  await expect(item(page, title)).toBeVisible();
  await layout(page);
  if (info.project.name === 'chromium-mobile') await page.screenshot({ path: 'suite-results/mobile-long-title.png', fullPage: true });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await layout(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // Computed-font doubling, not transform/viewport zoom. This is an automation approximation.
  await page.evaluate(() => {
    const elements = Array.from(document.body.getElementsByTagName('*'));
    const sizes = elements.map(e => parseFloat(getComputedStyle(e).fontSize));
    elements.forEach((e, i) => e.style.setProperty('font-size', `${sizes[i] * 2}px`, 'important'));
  });
  await layout(page);
  await rename(page, title, 'Changed at enlarged text');
  await layout(page);
  await save(page);
  await expect(item(page, 'Changed at enlarged text')).toBeVisible();
});

test('Keyboard-only lifecycle, focus recovery and automated accessibility', async ({ app, page }) => {
  await page.goto(app.baseURL);
  await accessible(page);
  const input = page.getByRole('textbox', { name: 'New todo', exact: true });
  await tabTo(page, input);
  await page.keyboard.type('Keyboard todo');
  await tabTo(page, page.getByRole('button', { name: 'Add todo', exact: true }));
  await page.keyboard.press('Enter');
  await expect(item(page, 'Keyboard todo')).toBeVisible();
  await tabTo(page, item(page, 'Keyboard todo').getByRole('button', { name: 'Rename', exact: true }));
  await page.keyboard.press('Enter');
  const title = editor(page).getByRole('textbox', { name: 'Todo title', exact: true });
  await tabTo(page, title);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Renamed with keys');
  await tabTo(page, editor(page).getByRole('button', { name: 'Save', exact: true }));
  await page.keyboard.press('Enter');
  await expect(item(page, 'Renamed with keys')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const checkbox = item(page, 'Renamed with keys').getByRole('checkbox', { name: 'Completed', exact: true });
  await tabTo(page, checkbox);
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  const filters = page.getByRole('group', { name: 'Filter todos', exact: true });
  for (const name of ['Open', 'Completed', 'All']) {
    const button = filters.getByRole('button', { name, exact: true });
    await tabTo(page, button);
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    if (name === 'Open') await expect(list(page)).toContainText('No open todos');
    else await expect(item(page, 'Renamed with keys')).toBeVisible();
  }
  await tabTo(page, checkbox);
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await accessible(page);
  await tabTo(page, item(page, 'Renamed with keys').getByRole('button', { name: 'Delete', exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Delete todo', exact: true });
  await expect.poll(async () => await dialog.isVisible() || await item(page, 'Renamed with keys').count() === 0).toBe(true);
  if (await dialog.isVisible()) {
    await tabTo(page, dialog.getByRole('button', { name: 'Confirm delete', exact: true }));
    await page.keyboard.press('Enter');
  }
  await expect(item(page, 'Renamed with keys')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement?.isConnected)).toBe(true);
  expect(await app.api.snapshot()).toEqual([]);
});

test('Database-denied browser write keeps input and never claims a saved Todo', async ({ app, page, database }, info) => {
  const sentinel = await app.api.create('Untouched');
  await page.goto(app.baseURL);
  await database.outage(true);
  try {
    await expect(database.query('SELECT 1')).rejects.toMatchObject({ code: '28000' });
    await add(page, 'Recover after database outage');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'New todo', exact: true })).toHaveValue('Recover after database outage');
  } finally { await database.outage(false); }
  expect(await app.api.snapshot()).toEqual([{ id: sentinel.id, title: 'Untouched', completed: false }]);
  const check = page.getByRole('button', { name: 'Check status', exact: true });
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(check.or(retry).first()).toBeVisible();
  if (await check.isVisible()) await check.click();
  await retry.click();
  await expect(item(page, 'Recover after database outage')).toBeVisible();
  expect((await app.api.list()).filter(r => r.title === 'Recover after database outage')).toHaveLength(1);
  expect(await app.api.read(sentinel.id)).toEqual(sentinel);
  await info.attach('injection', { body: JSON.stringify({ mode: 'database-login-denied', sqlstate: '28000' }), contentType: 'application/json' });
});
