'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Api } = require('../support/api');
const { OverrideEditor } = require('../support/pages/override-editor');

Given('the user can adjust a Table with a column called {string}', async function (column) {
  assert.equal(column, 'floor');
  this.editor = new OverrideEditor(await this.asSystemManager(), await Api.asSystemManager());
  await this.editor.prepare();
});
When('the user saves an adjustment that hides {string}', async function (column) { await this.editor.saveHidden(column); });
Then('the adjustment is saved without the user supplying an ID', async function () {
  const row = await this.editor.saved();
  assert.ok(row.row_id);
  assert.equal(row.value, 'true');
});
Then('the saved adjustment identifies its Table, {string} and {string}', async function (column, setting) { await this.editor.title(column, setting); });
Then('the user can open the affected Table from the saved adjustment', async function () { assert.equal(await this.editor.openTarget(), true); });
Given('the user is preparing an adjustment that hides {string}', async function (column) {
  this.editor = new OverrideEditor(await this.asSystemManager(), await Api.asSystemManager());
  await this.editor.prepare();
  await this.editor.chooseHidden(column);
});
When('the user chooses a different Table for the adjustment', async function () { await this.editor.changeTarget(); });
Then('the old column, setting and value are cleared', async function () { await this.editor.cleared(); });
When('the user saves a label adjustment for the whole Table', async function () { await this.editor.saveTableLabel(); });
Then('the adjustment is saved for the whole Table rather than a column', async function () {
  const row = await this.editor.saved();
  assert.ok(!row.column_name);
  assert.equal(row.property, 'label');
  assert.equal(row.value, 'Storage shelf');
});

Given('the user has saved an adjustment that hides {string}', async function (column) {
  this.editor = new OverrideEditor(await this.asSystemManager(), await Api.asSystemManager());
  await this.editor.prepare();
  await this.editor.saveHidden(column);
});
When('the user tries to add the same adjustment again', async function () { await this.editor.attemptDuplicate(); });
Then('the user is told to edit the existing adjustment', async function () { await this.editor.refused(); });
Then('only the original adjustment is saved', async function () { assert.equal(await this.editor.originalCount(), 1); });
When('the user tries to move it to a setting that already has an adjustment', async function () { await this.editor.attemptOccupiedMove(); });
Then('the original adjustment stays on its previous Table', async function () {
  const row = await this.editor.saved();
  assert.equal(row.table_name, this.editor.table);
  assert.equal(row.column_name, 'floor');
  assert.equal(row.value, 'true');
});
When('the user moves the adjustment to another Table', async function () { await this.editor.move(); });
Then('the old Table no longer hides its column', async function () { assert.equal(await this.editor.columnHidden(this.editor.table, 'floor'), false); });
Then('the new Table hides the selected column', async function () { assert.equal(await this.editor.columnHidden(this.editor.other, 'aisle'), true); });
