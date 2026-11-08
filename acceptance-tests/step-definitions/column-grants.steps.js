'use strict';

// Steps for a grant that reaches only some columns (permissions-and-roles,
// #917). One made-up quote, read in full but changeable only in its title.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { FormPage } = require('../support/pages/form-page');

const QUOTES = 'Grant Quote';
const ROLE = 'Grant Quote Title Editor';
const QUOTE = { row_id: 'Q-1', quote_title: 'Steel shelf', unit_cost: 120 };

Given("a role may read a quote's title and unit cost but may change only its title", async function () {
  await this.withApi(async (api) => {
    await api.createTable({
      name: QUOTES,
      columns: [
        { column_name: 'quote_title', label: 'Title', column_type: 'Data', in_list_view: true },
        { column_name: 'unit_cost', label: 'Unit cost', column_type: 'Float' },
      ],
    }, [QUOTE]);
    const role = await api.call('GET', `/api/table/Role/${encodeURIComponent(ROLE)}`);
    if (role.status() !== 200) await api.saveRow('Role', { row_id: ROLE });
    const meta = await (await api.call('GET', `/api/table/Table/${encodeURIComponent(QUOTES)}`, undefined, [200], 'read the quote table')).json();
    const title = meta.columns.find((column) => column.column_name === 'quote_title');
    await api.saveRow('Permission', { ref_table: QUOTES, role: ROLE, operation: 'read' });
    await api.saveRow('Permission', {
      ref_table: QUOTES, role: ROLE, operation: 'update', column_rule: 'listed',
      columns: [{ target_column: title.row_id }],
    });
  });
});

Given('the user holds that role', async function () {
  await this.person('the user', [ROLE]);
});

When('the user changes the title and the unit cost of the quote {string} and saves', async function (rowId) {
  const page = await this.actor();
  const form = new FormPage(page);
  await form.open('grant-quote', rowId);
  await page.locator('[data-field=quote_title]').fill('Steel shelf, two bays');
  await page.locator('[data-field=unit_cost]').fill('95');
  await page.getByTestId('form-save').click();
  this.banner = page.getByTestId('form-banner');
  await this.banner.waitFor();
});

Then('the save is refused', async function () {
  const text = (await this.banner.innerText()).trim();
  assert.notEqual(text, 'Saved');
  assert.match(text, /permission/i);
});

Then('the quote {string} keeps its old title and unit cost', async function (rowId) {
  const stored = await this.withApi((api) => api.row(QUOTES, rowId));
  assert.equal(stored.quote_title, QUOTE.quote_title);
  assert.equal(Number(stored.unit_cost), QUOTE.unit_cost);
});
