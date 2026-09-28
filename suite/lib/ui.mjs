import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const list = page => page.getByRole('region', { name: 'Todos', exact: true });
export const item = (page, title) => list(page).getByRole('group', { name: title, exact: true });
export const editor = page => page.getByRole('group', { name: 'Rename todo', exact: true }).or(page.getByRole('dialog', { name: 'Rename todo', exact: true }));
export async function add(page, title) {
  await page.getByRole('textbox', { name: 'New todo', exact: true }).fill(title);
  await page.getByRole('button', { name: 'Add todo', exact: true }).click();
}
export async function rename(page, title, draft) {
  await item(page, title).getByRole('button', { name: 'Rename', exact: true }).click();
  await editor(page).getByRole('textbox', { name: 'Todo title', exact: true }).fill(draft);
}
export async function save(page) { await editor(page).getByRole('button', { name: 'Save', exact: true }).click(); }
export async function remove(page, title) {
  await item(page, title).getByRole('button', { name: 'Delete', exact: true }).click();
  // Auto-wait for either disappearance or the optional confirmation, not an immediate visibility race.
  const dialog = page.getByRole('dialog', { name: 'Delete todo', exact: true });
  await expect.poll(async () => await dialog.isVisible() || await item(page, title).count() === 0 || await page.getByRole('alert').count() > 0).toBe(true);
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click();
}
export async function filter(page, name) {
  const group = page.getByRole('group', { name: 'Filter todos', exact: true });
  await group.getByRole('button', { name, exact: true }).click();
  await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  for (const other of ['All', 'Open', 'Completed'].filter(n => n !== name)) await expect(group.getByRole('button', { name: other, exact: true })).toHaveAttribute('aria-pressed', 'false');
}
export async function draftRetained(page, draft) {
  await expect(editor(page).getByRole('textbox', { name: 'Todo title', exact: true })).toHaveValue(draft);
}
export async function conflict(page, draft) {
  await expect(page.getByRole('alert')).toContainText('Todo changed');
  if (draft !== undefined) await draftRetained(page, draft);
  await expect(page.getByRole('button', { name: 'Review latest', exact: true })).toBeVisible();
}
export async function layout(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const controls = page.getByRole('button').or(page.getByRole('checkbox')).or(page.getByRole('textbox'));
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    expect(await control.evaluate(element => {
      const r = element.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top === element || element.contains(top);
    })).toBe(true); // Detect controls obscured at their activation point.
  }
}
export async function accessible(page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations).toEqual([]);
}
export async function associatedError(input) {
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await input.evaluate(element => {
    const ids = `${element.getAttribute('aria-describedby') || ''} ${element.getAttribute('aria-errormessage') || ''}`.trim().split(/\s+/);
    return ids.some(id => document.getElementById(id)?.textContent.trim());
  })).toBe(true);
}
export async function tabTo(page, target) {
  for (let step = 0; step < 80; step++) {
    if (await target.evaluate(element => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Control not reachable by keyboard within 80 Tab presses');
}
