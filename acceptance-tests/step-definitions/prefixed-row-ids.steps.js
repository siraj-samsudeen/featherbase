'use strict';

// Steps for rows named by fixed text plus a column (naming-and-numbering,
// #858). Setup and the rows a scenario adds go through the API; the builder's
// sample id and the form's Rename offer are read from the screen.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TableBuilderPage } = require('../support/pages/table-builder-page');
const { FormPage } = require('../support/pages/form-page');

const PLANT = 'Plant';
const COLUMNS = [
  { column_name: 'plant_code', label: 'Plant Code', column_type: 'Data' },
  { column_name: 'city', label: 'City', column_type: 'Data' },
];

async function plantTable(world, prefix) {
  await world.withApi((api) => api.createTable({ name: PLANT, module: 'Custom', id_pattern: `${prefix}{plant_code}`, columns: COLUMNS }));
}

// Adds a plant and keeps the answer, a refusal included.
async function addPlant(world, code, city = 'Chennai') {
  world.answer = await world.withApi(async (api) => {
    const res = await api.call('POST', '/api/save_row', { table: PLANT, row: { plant_code: String(code), city } });
    return { status: res.status(), body: await res.json() };
  });
}

async function existingPlant(world, rowId) {
  await plantTable(world, rowId.slice(0, rowId.indexOf('-') + 1));
  await addPlant(world, rowId.slice(rowId.indexOf('-') + 1));
  assert.equal(world.answer.body.row_id, rowId);
}

// ---- Given ----

Given('a table {string} whose rows are named {string} followed by their plant code', async function (name, prefix) {
  assert.equal(name, PLANT);
  await plantTable(this, prefix);
});

Given('the user is building a table {string} with a column {string}', async function (name, label) {
  await this.removeTableIfPresent(name);
  this.builder = new TableBuilderPage(await this.asSystemManager());
  await this.builder.open();
  await this.builder.name(name);
  await this.builder.typeColumns([label]);
});

Given(/^plant (\S+) exists$/, async function (rowId) {
  await existingPlant(this, rowId);
});

Given(/^plant (\S+) is open$/, async function (rowId) {
  await existingPlant(this, rowId);
  this.form = new FormPage(await this.asSystemManager());
  await this.form.open('plant', rowId);
  this.openRow = rowId;
});

// ---- When ----

When('the user adds a plant with the plant code {int}', async function (code) {
  await addPlant(this, code);
});

When('the user adds another plant with the plant code {int}', async function (code) {
  await addPlant(this, code, 'Madurai');
});

When('the user names its rows {string} followed by the plant code', async function (prefix) {
  await this.builder.nameRowsAfter('plant_code', prefix);
});

When('the user changes its plant code to {int}', async function (code) {
  await this.form.setAndSave('plant_code', String(code));
});

// ---- Then ----

Then(/^the plant is named (\S+)$/, function (rowId) {
  assert.equal(this.answer.status, 201, JSON.stringify(this.answer.body));
  assert.equal(this.answer.body.row_id, rowId);
});

Then(/^the builder says ids look like (.+)$/, async function (sample) {
  const said = await this.builder.namingPreview();
  assert.equal(said, `Ids look like ${sample}`);
});

Then('the save is refused, naming the plant code', function () {
  assert.equal(this.answer.status, 417, JSON.stringify(this.answer.body));
  assert.match(this.answer.body.error.message, /plant_code/);
});

Then(/^(\S+) is unchanged$/, async function (rowId) {
  const row = await this.withApi((api) => api.row(PLANT, rowId));
  assert.equal(row.city, 'Chennai');
});

Then(/^the plant keeps the id (\S+)$/, async function (rowId) {
  const row = await this.withApi((api) => api.row(PLANT, rowId));
  assert.equal(row.row_id, rowId);
  assert.notEqual(row.plant_code, rowId.slice(rowId.indexOf('-') + 1), 'the plant code was changed');
});

Then(/^the form offers Rename to (\S+)$/, async function (rowId) {
  assert.equal(await this.form.offeredRename(), `Rename to ${rowId}`);
});
