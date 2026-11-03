'use strict';

// A data source's Browse screen: the tables it holds, which can be connected,
// and connecting them.

class SourceBrowserPage {
  constructor(page) {
    this.page = page;
  }

  async open(source, schema) {
    await this.page.goto(`/featherbase/admin/source/${encodeURIComponent(source)}`);
    await this.page.getByTestId('sb-schema').fill(schema);
    await this.page.getByTestId('sb-load').click();
  }

  row(table) {
    return this.page.getByTestId(`sb-row-${table}`);
  }

  /** The box that selects a table for connecting; disabled when it cannot be. */
  choice(schema, table) {
    return this.page.getByRole('checkbox', { name: `Reflect ${schema}.${table}` });
  }

  /** Why a table cannot be connected, as the screen says it. */
  async refusal(table) {
    return (await this.row(table).locator('td').last().innerText()).trim();
  }

  /** Connects the chosen table and returns the name of the Table it became. */
  async connect(schema, table) {
    await this.choice(schema, table).check();
    await this.page.getByTestId('sb-reflect').click();
    const created = this.page.getByTestId('sb-result').getByRole('link').first();
    await created.waitFor();
    return (await created.innerText()).trim();
  }
}

module.exports = { SourceBrowserPage };
