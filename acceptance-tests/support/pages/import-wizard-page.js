'use strict';

// The Import Wizard, for a one-sheet file imported as a new table.
//
// The "In list" tick per column and the "Tick all" / "Clear" links above it
// are #738's agreed design (points 6-8). Until they are built, the methods
// that need them fail at once with a message naming what is missing, rather
// than waiting out a timeout.

const { tableHref } = require('../../../packages/shared/src/app-routes.ts');
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

  /** Enter from the existing table's list, just as a returning importer does. */
  async openForTable(table) {
    await this.page.goto(tableHref(table));
    await this.page.getByTestId('open-import').click();
    await this.page.getByTestId('import-wizard').waitFor();
  }

  async matchOn(column) {
    await this.page.getByTestId('iw-key-0').selectOption(column);
    await this.page.getByTestId('iw-preview-0').waitFor();
  }

  async check() {
    await this.page.getByTestId('iw-check').click();
    await this.page.getByTestId('iw-check-0').waitFor();
  }

  async previewText(checked = false) {
    return (await this.page.getByTestId(checked ? 'iw-check-0' : 'iw-preview-0').innerText()).replace(/\s+/g, ' ');
  }

  async explainsMatchingOn(label) {
    const explanation = (await this.card.innerText()).replace(/\s+/g, ' ');
    return ['match', 'matching', 'matched', 'matches'].some(verb => explanation.toLowerCase().includes(`${verb} on ${label.toLowerCase()}`))
      && !/rows (?:will be |are )?(?:appended|added to it)|always adds? (?:new )?rows/i.test(explanation);
  }

  async settleChoices() {
    await this.page.getByTestId('iw-key-0').waitFor();
    await this.page.waitForLoadState('networkidle');
  }

  async activeKey() {
    return this.page.getByTestId('iw-key-0').inputValue();
  }

  async suggestionText() {
    return (await this.card.innerText()).replace(/\s+/g, ' ');
  }

  async offersMatchingOn(label) {
    return this.card.getByRole('button', { name: `Match on ${label}`, exact: true }).isVisible();
  }

  async acceptMatchingOn(label) {
    const accept = this.card.getByRole('button', { name: `Match on ${label}`, exact: true });
    if (!await accept.isVisible()) throw new Error(`No explicit "Match on ${label}" suggestion to accept. ${await this.suggestionText()}`);
    await accept.click();
    await this.page.getByTestId('iw-preview-0').waitFor();
  }

  async unmapFirstColumn() {
    await this.page.getByTestId('iw-map-use-0-0').uncheck();
    await this.settleChoices();
  }

  async keyChoices() {
    return this.page.getByTestId('iw-key-0').locator('option').evaluateAll(options => options.map(option => option.value));
  }

  /** Observe whichever gate (or actual completion) a click reaches. Never bypass it. */
  async attemptImport() {
    await this.page.getByTestId('iw-import').click();
    await this.page.getByTestId('iw-confirm-updates')
      .or(this.page.getByTestId('iw-append-warning'))
      .or(this.page.getByTestId('iw-done'))
      .or(this.page.getByTestId('list-view')).first().waitFor({ timeout: 30_000 });
  }

  async confirmationText() {
    const confirmation = this.page.getByTestId('iw-confirm-updates');
    return await confirmation.isVisible() ? confirmation.innerText() : '';
  }

  async completed() {
    return await this.page.getByTestId('iw-done').isVisible() || await this.page.getByTestId('list-view').isVisible();
  }

  async appendWarningText() {
    const warning = this.page.getByTestId('iw-append-warning');
    return await warning.isVisible() ? warning.innerText() : '';
  }

  async acknowledgeAppend() {
    if (!await this.page.getByTestId('iw-append-warning').isVisible())
      throw new Error('Missing full-overlap append warning: import already proceeded without acknowledgement');
    await this.page.getByTestId('iw-append-ack').check();
    await this.page.getByTestId('iw-append-go').click();
    await this.page.getByTestId('iw-done').or(this.page.getByTestId('list-view')).first().waitFor({ timeout: 30_000 });
  }

  async missingAndWrongCountsBlock() {
    const input = this.page.getByTestId('iw-confirm-input');
    const go = this.page.getByTestId('iw-confirm-go');
    await input.fill('');
    if (!await go.isDisabled()) return false;
    await input.fill('20');
    if (!await go.isDisabled()) return false;
    await input.fill('21');
    return await go.isEnabled() && !await this.completed();
  }

  async latestHistoryText(table) {
    if (!await this.completed()) throw new Error(`Import has not completed: ${await this.confirmationText()}`);
    await this.openForTable(table);
    await this.page.getByTestId('iw-run-0').waitFor();
    return this.page.getByTestId('iw-run-0').innerText();
  }

  async unchangedUndoText() {
    await this.page.getByTestId('iw-revert-open-h0').click();
    await this.page.getByTestId('iw-revert-preview-h0').waitFor();
    return this.page.getByTestId('iw-revert-preview-h0').innerText();
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
