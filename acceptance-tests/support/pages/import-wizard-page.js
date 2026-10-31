'use strict';

// The Import Wizard, for a one-sheet file imported as a new table.
//
// The "In list" tick per column and the "Tick all" / "Clear" links above it
// are #738's agreed design (points 6-8). Until they are built, the methods
// that need them fail at once with a message naming what is missing, rather
// than waiting out a timeout.

const NEW_TABLE = 'New Table…';

class ImportWizardPage {
  constructor(page) {
    this.page = page;
    this.card = page.getByTestId('iw-sheet-0');
  }

  async open() {
    await this.page.goto('/featherbase/admin');
    await this.page.getByTestId('import-data-link').click();
    await this.page.getByTestId('import-wizard').waitFor();
  }

  /** Drops a CSV file onto the wizard. */
  async dropCsv(fileName, csv) {
    await this.page.getByTestId('iw-file-input').setInputFiles({
      name: fileName,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await this.page.getByTestId('iw-target-0').waitFor();
  }

  /** Targets a new table with this name. */
  async asNewTable(name) {
    const target = this.page.getByTestId('iw-target-0');
    if ((await target.inputValue()) !== NEW_TABLE) {
      await target.click();
      await this.page.getByTestId('iw-target-new-0').click();
    }
    await this.page.getByTestId('iw-new-name-0').fill(name);
  }

  columnRows() {
    return this.page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]');
  }

  async columnRow(label) {
    const rows = this.columnRows();
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      if ((await rows.nth(i).locator('[data-rowfield=label]').inputValue()) === label) return rows.nth(i);
    }
    throw new Error(`The Import Wizard has no column "${label}"`);
  }

  /** Unticks "Use" for a column, leaving it out of the import. */
  async leaveOut(label) {
    await (await this.columnRow(label)).locator('[data-rowfield=include]').uncheck();
  }

  /** Clicks "Tick all" above the In list column. */
  async tickAllInList() {
    const tickAll = this.card.getByText('Tick all', { exact: true });
    if ((await tickAll.count()) === 0) {
      throw new Error('The Import Wizard\'s column step offers no "Tick all" for the In list column (#738 point 8)');
    }
    await tickAll.click();
  }

  /**
   * Imports every target and waits for the result: a one-sheet import into a
   * new table lands on that table's list; otherwise the wizard's summary.
   */
  async importAll() {
    await this.page.getByTestId('iw-import').click();
    const done = this.page.getByTestId('iw-done');
    const landed = this.page.getByTestId('list-view');
    try {
      await done.or(landed).first().waitFor({ timeout: 30_000 });
    } catch {
      const said = (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
      throw new Error(`The import did not finish (at ${this.page.url()}). The page says: ${said.slice(0, 1500)}`);
    }
    if (await done.isVisible()) {
      const result = (await this.page.getByTestId('iw-result-0').textContent()) ?? '';
      if (!/Imported \d+ rows? into/.test(result)) throw new Error(`The import did not succeed: ${result}`);
    }
  }
}

module.exports = { ImportWizardPage };
