'use strict';

// #772: connecting a MotherDuck warehouse by its token, its source page, the
// sidebar's Data sources group, searchable catalog, preview and copy setup.

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
    await this.showCatalog();
    await this.page.getByRole('combobox', { name: 'Schema', exact: true }).selectOption(schema);
  }

  async pickTable(table) {
    await this.showCatalog();
    await this.page.getByRole('table', { name: 'Warehouse tables', exact: true }).getByRole('button', { name: table, exact: true }).click();
    await this.page.getByTestId('preview-size').filter({ hasText: 'rows' }).waitFor();
  }

  /** The open database and the selected schema. */
  async place() {
    await this.showCatalog();
    const database = await this.page.getByTestId('browser-database').inputValue();
    const schema = await this.page.getByRole('combobox', { name: 'Schema', exact: true }).inputValue();
    return { database, schema };
  }

  async showCatalog() {
    await this.page.getByRole('tab', { name: /tables|catalog/i }).click();
  }

  async showPreview(table) {
    await this.page.getByRole('tab', { name: `Preview · ${table}`, exact: true }).click();
    await this.page.getByTestId('preview-size').filter({ hasText: 'rows' }).waitFor();
  }

  async previewSelected(table) {
    return this.page.getByRole('tab', { name: `Preview · ${table}`, exact: true }).getAttribute('aria-selected');
  }

  async searchTables(query) {
    await this.page.getByRole('searchbox', { name: 'Tables', exact: true }).fill(query);
  }

  async catalogContext() {
    return {
      ...await this.place(),
      query: await this.page.getByRole('searchbox', { name: 'Tables', exact: true }).inputValue(),
      tables: await this.tables(),
    };
  }

  async openCopy() {
    await this.page.getByTestId('preview-copy').click();
    await this.page.getByTestId('copy-setup').waitFor();
    return new WarehouseCopyPage(this.page);
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
    const catalog = this.page.getByRole('table', { name: 'Warehouse tables', exact: true });
    await catalog.waitFor();
    return catalog.locator('tbody tr th').allInnerTexts();
  }

  /** Refreshes the table list and waits for the fresh list to come back. */
  async refresh() {
    await Promise.all([
      this.page.waitForResponse((res) => res.url().includes(':refresh_tables') && res.ok()),
      this.page.getByTestId('browser-refresh').click(),
    ]);
  }
}

class WarehouseCopyPage {
  constructor(page) {
    this.page = page;
  }

  async create(name) {
    await this.page.getByTestId('copy-name').fill(name);
    await this.page.getByTestId('copy-key').selectOption('code');
    const response = this.page.waitForResponse((res) => res.url().endsWith(':copy_create') && res.request().method() === 'POST');
    await this.page.getByTestId('copy-create').click();
    const res = await response;
    if (!res.ok()) throw new Error(`copy creation refused: ${res.status()} ${await res.text()}`);
    await this.page.getByTestId('list-view').waitFor();
    return new CopiedWarehousePage(this.page, name);
  }

  async editColumn(source, { name, label, description }) {
    await this.page.getByRole('textbox', { name: `Name for ${source}`, exact: true }).fill(name);
    await this.page.getByRole('textbox', { name: `Label for ${source}`, exact: true }).fill(label);
    await this.page.getByRole('textbox', { name: `Description for ${source}`, exact: true }).fill(description);
  }

  async omit(source) {
    await this.page.getByRole('checkbox', { name: `Keep ${source}`, exact: true }).uncheck();
  }

  async search(query) {
    await this.page.getByRole('searchbox', { name: 'Column mapping', exact: true }).fill(query);
  }

  async visibleColumns() {
    return this.page.getByRole('textbox', { name: /^Name for / }).evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label').slice('Name for '.length)));
  }

  async column(source) {
    return {
      name: await this.page.getByRole('textbox', { name: `Name for ${source}`, exact: true }).inputValue(),
      label: await this.page.getByRole('textbox', { name: `Label for ${source}`, exact: true }).inputValue(),
      description: await this.page.getByRole('textbox', { name: `Description for ${source}`, exact: true }).inputValue(),
      keep: await this.page.getByRole('checkbox', { name: `Keep ${source}`, exact: true }).isChecked(),
    };
  }

  async returnToPreview(table) {
    await this.page.getByTestId('copy-setup').getByRole('link', { name: table, exact: true }).click();
    await this.page.getByTestId('warehouse-browser').waitFor();
    await this.page.getByRole('tab', { name: `Preview · ${table}`, exact: true }).waitFor();
    return new WarehouseBrowserPage(this.page);
  }
}

class CopiedWarehousePage {
  constructor(page, table) {
    this.page = page;
    this.table = table;
  }

  async open() {
    await this.page.goto(`/featherbase/admin/${encodeURIComponent(this.table)}`);
    await this.page.getByTestId('list-view').waitFor();
  }

  async rowIds() {
    const links = this.page.getByTestId('list-rows').getByRole('link');
    await links.first().waitFor();
    return links.allTextContents();
  }

  async copyAgain() {
    const response = this.page.waitForResponse((res) => res.url().endsWith(':copy_again') && res.request().method() === 'POST');
    await this.page.getByTestId('copy-again').click();
    const res = await response;
    if (!res.ok()) throw new Error(`copy again refused: ${res.status()} ${await res.text()}`);
    await this.page.getByTestId('copy-result').waitFor();
  }
}

module.exports = { ConnectWarehousePage, WarehouseSourcePage, DataSourcesSidebar, WarehouseBrowserPage, WarehouseCopyPage, CopiedWarehousePage };
