'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// #832: a link inside a grid of nested rows (a person's roles) is picked
// from the linked Table's rows, as a link field on the form is.
class NestedLink {
  constructor(page) { this.page = page; }

  static async newPerson(api) {
    const email = `nested-link-${randomUUID().slice(0, 8)}@example.com`;
    const res = await api.call('POST', '/api/save_row', { table: 'Person', row: { email, enabled: true } }, [201], 'create a person');
    return (await res.json()).row_id;
  }

  static async rolesOf(api, person) {
    const res = await api.call('GET', `/api/table/Person/${encodeURIComponent(person)}`, undefined, [200], 'read the person');
    return ((await res.json()).roles ?? []).map((r) => r.role);
  }

  async addRole(person) {
    this.person = person;
    await this.page.goto(`/featherbase/admin/Person/${encodeURIComponent(person)}`);
    await this.page.getByTestId('form-view').waitFor();
    await this.page.getByTestId('add-row-roles').click();
    this.cell = this.page.getByTestId('table-roles').locator('[data-childfield="role"]').last();
  }

  async type(text) {
    await this.cell.click();
    await this.cell.fill(text);
  }

  async pick(name) {
    const options = this.page.getByTestId('link-options-role').getByTestId('link-option');
    await options.filter({ hasText: name }).first().waitFor();
    this.offered = await options.allTextContents();
    await options.filter({ hasText: name }).first().click();
  }

  expectOfferedOnly(fragment) {
    assert.ok(this.offered.length > 0, 'no roles were offered');
    for (const name of this.offered) assert.match(name, new RegExp(fragment, 'i'));
  }

  async leave() { await this.page.getByTestId('form-view').locator('h1, h2').first().click(); }

  async save() {
    await this.page.getByTestId('form-save').click();
  }

  async expectSaved() {
    await this.page.getByTestId('form-save').click();
    await this.page.getByTestId('form-save').getByText('Save').waitFor();
    await this.page.waitForFunction(() => !document.querySelector('[data-testid="form-save"]:not([disabled])'), null, { timeout: 10_000 });
  }

  async expectRefused() {
    await this.save();
    await this.page.getByTestId('table-roles').getByText(/required|pick|choose/i).first().waitFor({ timeout: 10_000 });
    assert.equal(await this.page.getByTestId('form-save').isEnabled(), true, 'the form claims it was saved');
  }
}

module.exports = { NestedLink };
