'use strict';

// The Edit columns page of a table (its Columns screen): add, rename, and
// choose which columns are in the list for everyone.

class ColumnEditorPage {
  constructor(page) {
    this.page = page;
  }

  async open(table) {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(table)}/columns`);
    await this.page.getByTestId('column-editor').waitFor();
  }

  rows() {
    return this.page.getByTestId('ce-columns-table').locator('tbody tr');
  }

  /** The row of the column with this label. */
  async rowFor(label) {
    const labels = await this.rows().evaluateAll((trs) =>
      trs.map((tr) => tr.querySelector('input[data-testid^="ce-label-"]')?.value ?? ''),
    );
    const at = labels.indexOf(label);
    if (at < 0) throw new Error(`the Edit columns page has no column ${label}; it has: ${labels.join(', ')}`);
    return this.rows().nth(at);
  }

  /** Ticks "In list" for a column, which saves at once; waits for the save. */
  async putInList(label) {
    const tick = (await this.rowFor(label)).getByRole('checkbox', { name: /in list/i });
    if ((await tick.count()) === 0)
      throw new Error(`the Edit columns page has no "In list" tick for ${label}`);
    if (await tick.isChecked()) return;
    const saved = this.page.waitForResponse(
      (r) => r.url().includes('/api/table_def/') && r.request().method() === 'PUT',
    );
    await tick.check();
    const res = await saved;
    if (!res.ok()) throw new Error(`the "In list" tick was not saved: ${res.status()} ${await res.text()}`);
  }

  /** What the page says about whose columns these are, or null. */
  async platformNotice() {
    const notice = this.page.getByTestId('ce-system');
    return (await notice.count()) ? (await notice.textContent()).trim() : null;
  }

  /** The ways the page offers to add a column or rename one, by name. */
  async waysToAddOrRename() {
    const ways = [];
    if (await this.page.getByTestId('ce-add').count()) ways.push('add a column');
    const renames = await this.page.locator('[data-testid^="ce-rename-"]').count();
    if (renames) ways.push(`${renames} rename control(s)`);
    const editableLabels = await this.page.locator('input[data-testid^="ce-label-"]:enabled').count();
    if (editableLabels) ways.push(`${editableLabels} editable label(s)`);
    return ways;
  }
}

module.exports = { ColumnEditorPage };
