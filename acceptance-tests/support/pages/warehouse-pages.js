'use strict';

// #772: connecting a MotherDuck warehouse by its token, its source page, the
// sidebar's Data sources group, and the schema → table → preview browser.

const SOURCE_TABLE = 'Data%20Source';

class ConnectWarehousePage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    await this.page.goto(`/featherbase/admin/${SOURCE_TABLE}/new`);
    await this.page.getByTestId('kind-motherduck').click();
  }

  async name(name) {
    await this.page.getByTestId('connect-name').fill(name);
  }

  async test(token) {
    await this.page.getByTestId('connect-token').fill(token);
    await this.page.getByTestId('connect-test').click();
    // The result replaces the hint once the test has answered.
    await this.page.getByTestId('connect-result').filter({ hasText: /Connected|refused|cannot|could not/ }).waitFor();
  }

  async result() {
    return this.page.getByTestId('connect-result').innerText();
  }

  async tick(database) {
    await this.page.getByTestId(`db-${database}`).check();
  }

  async databasesOffered() {
    return this.page.getByTestId('connect-databases').isVisible();
  }

  async canSave() {
    return this.page.getByTestId('connect-save').isEnabled();
  }

  async save() {
    await this.page.getByTestId('connect-save').click();
    await this.page.getByTestId('warehouse-browser').waitFor();
  }
}

class WarehouseSourcePage {
  constructor(page) {
    this.page = page;
  }

  async open(name) {
    await this.page.goto(`/featherbase/admin/${SOURCE_TABLE}/${encodeURIComponent(name)}`);
    await this.page.getByTestId('warehouse-token').waitFor();
  }

  async token() {
    return this.page.getByTestId('warehouse-token').innerText();
  }

  /** The token line once it names these last four (it refreshes after a replace). */
  async tokenEnding(four) {
    const line = this.page.getByTestId('warehouse-token').filter({ hasText: `…${four}` });
    await line.waitFor({ timeout: 15_000 }).catch(() => {});
    return this.token();
  }

  async pageText() {
    return this.page.locator('body').innerText();
  }

  async replaceToken(token) {
    await this.page.getByTestId('replace-token').click();
    await this.page.getByTestId('replace-token-input').fill(token);
    await this.page.getByTestId('replace-token-save').click();
    await this.page.getByTestId('replace-token').waitFor();
  }
}

class DataSourcesSidebar {
  constructor(page) {
    this.page = page;
  }

  async openAdmin() {
    await this.page.goto('/featherbase/admin');
    await this.page.getByTestId('sidebar-group-data').waitFor();
  }

  async shown() {
    return this.page.getByTestId('sidebar-group-sources').isVisible();
  }

  /** The databases listed under one source. */
  async databasesUnder(source) {
    const group = this.page.getByTestId('sidebar-group-sources');
    await group.waitFor();
    const block = group.getByTestId('sidebar-source').filter({ has: this.page.getByTestId('sidebar-source-link').getByText(source, { exact: true }) });
    await block.waitFor();
    return block.getByTestId('sidebar-source-database').allInnerTexts();
  }

  async openDatabase(source, database) {
    const group = this.page.getByTestId('sidebar-group-sources');
    const block = group.getByTestId('sidebar-source').filter({ has: this.page.getByTestId('sidebar-source-link').getByText(source, { exact: true }) });
    await block.getByTestId('sidebar-source-database').getByText(database, { exact: true }).click();
    await this.page.getByTestId('warehouse-browser').waitFor();
  }
}

class WarehouseBrowserPage {
  constructor(page) {
    this.page = page;
  }

  async open(source) {
    await this.page.goto(`/featherbase/admin/source/${encodeURIComponent(source)}`);
  }

  async refused() {
    await this.page.getByTestId('table-page').waitFor();
    return this.page.getByTestId('source-refused').isVisible();
  }

  async databasesOffered() {
    await this.page.getByTestId('warehouse-browser').waitFor();
    return this.page.getByTestId('browser-database').locator('option').allInnerTexts();
  }

  async pickDatabase(database) {
    await this.page.getByTestId('browser-database').selectOption(database);
  }

  async pickSchema(schema) {
    // A chosen schema is folded into a chip; the chip reopens the list.
    const chip = this.page.getByTestId('chip-schema');
    if (await chip.isVisible()) await chip.click();
    await this.page.getByTestId('schema-row').filter({ hasText: new RegExp(`^${schema}\\d`) }).click();
  }

  async pickTable(table) {
    const chip = this.page.getByTestId('chip-table');
    if (await chip.isVisible()) await chip.click();
    await this.page.getByTestId('table-row').filter({ hasText: new RegExp(`^${table}\\d`) }).click();
    await this.page.getByTestId('preview-size').filter({ hasText: 'rows' }).waitFor();
  }

  /** The open database and the selected schema. */
  async place() {
    await this.page.getByTestId('chip-schema').or(this.page.getByTestId('schema-row').first()).first().waitFor();
    const database = await this.page.getByTestId('browser-database').inputValue();
    const chip = this.page.getByTestId('chip-schema');
    const schema = (await chip.isVisible())
      ? (await chip.innerText()).replace(/^Schema\s*/, '').trim()
      : (await this.page.locator('[data-testid=schema-row][data-selected]').innerText()).split('\n')[0];
    return { database, schema };
  }

  async previewTitle() {
    return (await this.page.getByTestId('pane-preview').locator('h2').innerText()).trim();
  }

  async preview() {
    return {
      size: await this.page.getByTestId('preview-size').innerText(),
      rows: await this.page.getByTestId('preview-rows').innerText(),
      columns: await this.page.getByTestId('preview-columns').innerText(),
    };
  }

  async tables() {
    await this.page.getByTestId('table-row').first().waitFor();
    return (await this.page.getByTestId('table-row').allInnerTexts()).map((t) => t.split('\n')[0]);
  }

  /** Refreshes the table list and waits for the fresh list to come back. */
  async refresh() {
    await Promise.all([
      this.page.waitForResponse((res) => res.url().includes(':refresh_tables') && res.ok()),
      this.page.getByTestId('browser-refresh').click(),
    ]);
  }
}

module.exports = { ConnectWarehousePage, WarehouseSourcePage, DataSourcesSidebar, WarehouseBrowserPage };
