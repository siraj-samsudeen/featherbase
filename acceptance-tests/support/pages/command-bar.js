'use strict';

const assert = require('node:assert/strict');
const { expect } = require('playwright/test');

const TABLE = 'Sign In Method';
const LIST_PATH = `/featherbase/admin/${encodeURIComponent(TABLE)}`;

class CommandBar {
  constructor(page) { this.page = page; }

  input() { return this.page.getByRole('textbox', { name: 'Search or type a command', exact: true }); }
  dropdown() { return this.page.getByTestId('awesomebar-results'); }

  async visitSignInMethods() {
    const loaded = this.page.waitForResponse(response =>
      decodeURIComponent(new URL(response.url()).pathname) === `/api/table/${TABLE}` &&
      response.request().method() === 'GET');
    await this.page.goto(LIST_PATH);
    const response = await loaded;
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    assert.equal(Array.isArray(result.data), true);
    this.total = result.total;
    await this.expectSignInMethods();
  }

  async expectSignInMethods() {
    assert.equal(decodeURIComponent(new URL(this.page.url()).pathname), decodeURIComponent(LIST_PATH));
    const list = this.page.getByTestId('list-view');
    await list.getByRole('heading', { level: 1, name: /^Sign In Method(?:\s|$)/ }).waitFor();
    // A fresh instance can have no configured methods. Assert the HTTP
    // result's actual count rather than inventing seeded rows.
    await expect(list.getByTestId('list-total')).toHaveText(`${this.total} total`);
    assert.equal(await list.getByTestId('list-rows-error').count(), 0);
  }

  async open() {
    await this.page.keyboard.press('Meta+k');
    assert.equal(await this.input().evaluate(element => element === document.activeElement), true);
  }

  async searchSignInMethods() {
    await this.open();
    await this.input().fill(TABLE);
    await this.page.getByTestId('awesomebar-table').filter({ hasText: TABLE }).waitFor();
    await this.input().press('Enter');
  }

  async expectUnobstructedList() {
    await this.expectSignInMethods();
    await this.dropdown().waitFor({ state: 'hidden' });
  }

  async expectHistoryOnReopen() {
    await this.open();
    await this.page.getByTestId('awesomebar-recents').waitFor();
    await this.page.getByTestId('awesomebar-recents')
      .getByTestId('awesomebar-recent').filter({ hasText: TABLE }).first().waitFor();
  }

  async replaySignInMethodSearch() {
    await this.open();
    await this.input().fill('Sign In');
    await this.page.getByTestId('awesomebar-recent-search').filter({ hasText: TABLE }).click();
  }

  async expectEditableSearchAndRun() {
    assert.equal(await this.input().inputValue(), TABLE);
    assert.equal(await this.input().evaluate(element => element === document.activeElement), true);
    await this.dropdown().waitFor();
    // Edit with the keyboard without clicking/refocusing: replay must leave
    // the complete query in the focused, usable input.
    await this.input().press('End');
    await this.page.keyboard.type(' ');
    assert.equal(await this.input().inputValue(), `${TABLE} `);
    await this.page.keyboard.press('Backspace');
    assert.equal(await this.input().inputValue(), TABLE);
    await this.page.keyboard.press('Enter');
    await this.page.waitForFunction(() =>
      document.querySelector('[data-testid="awesomebar"] input')?.value === '');
    await this.expectUnobstructedList();
  }

  async searchPerson() {
    await this.page.goto('/featherbase/admin/all-tables');
    await this.page.getByTestId('all-tables-link').waitFor();
    await this.open();
    await this.input().fill('Person');
    await this.page.getByTestId('awesomebar-doc').waitFor();
  }

  async choosePersonResult(kind) {
    const target = this.page.getByTestId(kind === 'new' ? 'awesomebar-new' : 'awesomebar-doc');
    const count = await this.dropdown().getByRole('option').count();
    for (let i = 0; i < count; i++) {
      await this.input().press('ArrowDown');
      if (await target.getAttribute('aria-selected') === 'true') break;
    }
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await this.input().press('Enter');
  }

  async expectPersonForm(kind) {
    await expect(this.page).toHaveURL(new RegExp(kind === 'new' ? '/admin/Person/new$' : '/admin/Table/Person$'));
    await this.page.getByTestId('form-view').waitFor();
    await this.dropdown().waitFor({ state: 'hidden' });
  }

  async replacePersonSearch() {
    await this.input().fill('Sign In Meth');
    await this.input().press('Enter');
  }

  async expectReplacementSearch() {
    await expect(this.page).not.toHaveURL(/\/all-tables$/);
    assert.notEqual(decodeURIComponent(new URL(this.page.url()).pathname), '/featherbase/admin/Table/Person');
  }
}

module.exports = { CommandBar };
