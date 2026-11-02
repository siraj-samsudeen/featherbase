'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Api } = require('../support/api');
const { MetadataOverrides } = require('../support/pages/metadata-overrides');

Given('the user can customize a catalogue with a category column', async function () {
  this.overrides = new MetadataOverrides(await Api.asSystemManager());
  await this.overrides.prepare();
});

When('the user saves a customization using the category label instead of its name', async function () {
  await this.overrides.columnLabelAsName();
});

Then('the customization is refused with the missing column identified', function () {
  assert.equal(this.overrides.result.status, 417);
  assert.equal(this.overrides.result.body.error.type, 'ValidationError');
  assert.ok(this.overrides.result.body.error.message.includes(this.overrides.missing));
  assert.ok(this.overrides.result.body.error.message.includes(this.overrides.table));
});

When('the user customizes the whole catalogue label without choosing a column', async function () {
  await this.overrides.wholeTableLabel();
});

Then('the catalogue has the customized label', async function () {
  assert.equal(this.overrides.result.status, 201);
  assert.equal((await this.overrides.meta()).label, 'Customer catalogue');
});

Given('another catalogue has a supplier column', async function () { await this.overrides.otherCatalogue(); });
When('the user saves a supplier customization on the category catalogue', async function () { await this.overrides.foreignColumn(); });
Given('the user has added a priority column to that catalogue', async function () { await this.overrides.addPriority(); });
When('the user customizes the priority label', async function () { await this.overrides.priorityLabel(); });
Then('the user-added column has the customized label', async function () {
  assert.equal(this.overrides.result.status, 201);
  assert.equal((await this.overrides.meta()).columns.find(column => column.column_name === 'priority').label, 'Urgency');
});

Given('a category label customization is saved', async function () { await this.overrides.savedCategory(); });
When('the user edits that customization to use a missing column', async function () { await this.overrides.invalidTargetEdit(); });
Then('the saved category customization is unchanged', async function () {
  assert.deepEqual(await this.overrides.savedRow(), this.overrides.beforeRow);
  assert.deepEqual(await this.overrides.meta(), this.overrides.beforeMeta);
});
