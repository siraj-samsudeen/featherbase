'use strict';

// Steps for arranging a row's fields (core-forms, #795). The example is one parcel on a rack
// in the run's outside database; every value is made up.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { externalSql } = require('../support/stack');
const { givenReaderSource } = require('../support/outside-db');
const { FormPage } = require('../support/pages/form-page');

const SCHEMA = 'parcel_fixture';
const SOURCE = 'parcels';
const PARCEL = '7';
const COUNTER = 'Parcel Counter';
const MODES = { 'its fields by data type': 'type', 'its filled fields first': 'filled', 'its links first': 'links', "its fields in the table's own order": 'source' };
const GROUPS = { numbers: 'number', links: 'link', text: 'text', dates: 'date', files: 'file' };

// ---- Given ----

Given('a connected database of parcels on racks, where every parcel has a sender of up to {int} characters', async function (limit) {
  await externalSql(`drop schema if exists ${SCHEMA} cascade`);
  await externalSql(`create schema ${SCHEMA}`);
  await externalSql(`create table ${SCHEMA}.rack (id bigint primary key, label text)`);
  // Source order: who created it first, the label in the middle, the rack and
  // who updated it last, so no arrangement but the source's own matches it.
  await externalSql(`create table ${SCHEMA}.parcel (
    id bigint primary key,
    created_on timestamptz not null default now(),
    label varchar(300),
    weight numeric(6,2),
    note text,
    fragile boolean,
    instructions text,
    sent_on date,
    photo text,
    sender varchar(${limit}) not null,
    rack_id bigint references ${SCHEMA}.rack(id),
    updated_by varchar(60))`);
  for (const name of ['Parcel', 'Rack']) await this.withApi((api) => api.removeTableIfPresent(name));
  await givenReaderSource(this, SOURCE, SCHEMA, ['rack', 'parcel']);
  await this.withApi((api) => api.call('POST', `/api/table/Data%20Source/${SOURCE}:reflect`, {
    schema: SCHEMA, tables: ['rack', 'parcel'], names: { rack: 'Rack', parcel: 'Parcel' },
  }, [200], 'connect the rack and parcel tables'));
});

Given('a parcel labelled {string} on the rack {string}', async function (label, rack) {
  await externalSql(`insert into ${SCHEMA}.rack values (3, $1)`, [rack]);
  await externalSql(
    `insert into ${SCHEMA}.parcel (id, label, weight, fragile, instructions, sent_on, photo, sender, rack_id, updated_by)
     values (${PARCEL}, $1, 2.5, true, $2, '2026-10-30', 'parcels/blue-box.png', 'Front desk', 3, 'kiosk')`,
    [label, 'Keep upright.\nOpen from the top.'],
  );
});

async function readerOfParcelsAndRacks(world, who) {
  const roles = await world.withApi(async (api) => [await api.readerRoleFor('Parcel'), await api.readerRoleFor('Rack')]);
  await world.person(who, roles);
}

Given('the user may read parcels and racks', async function () {
  await readerOfParcelsAndRacks(this, 'the user');
});

Given('a colleague may read parcels and racks', async function () {
  await readerOfParcelsAndRacks(this, 'a colleague');
});

Given("the user arranged the parcel's fields by data type in one column", async function () {
  const form = new FormPage(await this.actor());
  await form.openRow('Parcel', PARCEL);
  await form.arrangeBy('type');
  // Done once the person's settings have taken the choice.
  const saved = form.page.waitForResponse((r) => r.url().includes('/api/user_settings/') && r.request().method() === 'PUT' && r.ok());
  await form.showColumns(1);
  await saved;
});

Given('a parcel counter table its builder laid out in two sections', async function () {
  await this.withApi((api) => api.createTable({
    name: COUNTER,
    id_pattern: 'prompt',
    columns: [
      { column_name: 'sender', label: 'Sender', column_type: 'Data' },
      { column_name: 'handed_in_on', label: 'Handed In On', column_type: 'Date' },
      { column_name: 'details', label: 'Details', column_type: 'Section Break' },
      { column_name: 'weight', label: 'Weight', column_type: 'Float' },
      { column_name: 'shelf_note', label: 'Shelf Note', column_type: 'Data' },
    ],
  }));
  const role = await this.withApi((api) => api.readerRoleFor(COUNTER));
  await this.person('the user', [role]);
});

Given('a parcel {string} at the parcel counter', async function (rowId) {
  await this.withApi((api) => api.call('POST', `/api/table/${encodeURIComponent(COUNTER)}`, {
    row_id: rowId, sender: 'Front desk', handed_in_on: '2026-10-30', weight: 2.5, shelf_note: 'Top',
  }, [201], 'add a parcel at the counter'));
  this.counterRow = rowId;
});

// ---- When ----

When('the user opens that parcel', async function () {
  this.form = new FormPage(await this.actor());
  await this.form.openRow('Parcel', PARCEL);
});

When('a colleague opens that parcel', async function () {
  this.form = new FormPage(await this.signedIn('a colleague'));
  await this.form.openRow('Parcel', PARCEL);
});

When('the user opens that parcel again', async function () {
  // A new browser: only what is kept for the person, not for this browser, comes back.
  this.form = new FormPage(await this.signedInAfresh('the user'));
  await this.form.openRow('Parcel', PARCEL);
});

When('the user opens that parcel and opens its empty fields', async function () {
  this.form = new FormPage(await this.actor());
  await this.form.openRow('Parcel', PARCEL);
  await this.form.openEmptyFields();
});

When(/^the user opens that parcel and arranges (its fields by data type|its filled fields first|its links first|its fields in the table's own order)$/, async function (how) {
  this.form = new FormPage(await this.actor());
  await this.form.openRow('Parcel', PARCEL);
  await this.form.arrangeBy(MODES[how]);
});

When('the user opens that parcel and shows its fields in one column', async function () {
  this.form = new FormPage(await this.actor());
  await this.form.openRow('Parcel', PARCEL);
  await this.form.showColumns(1);
});

When('the user opens that parcel at the parcel counter', async function () {
  this.form = new FormPage(await this.actor());
  await this.form.open(COUNTER, this.counterRow);
});

// ---- Then ----

async function seesOrder(form, columns) {
  const shown = await form.fieldLabels();
  assert.deepEqual(shown, columns, `the parcel's fields read ${shown.join(', ')}`);
}

Then("the user sees the parcel's fields in the order {columns}", async function (columns) {
  await seesOrder(this.form, columns);
});

Then("the colleague sees the parcel's fields in the order {columns}", async function (columns) {
  await seesOrder(this.form, columns);
});

Then('the user sees one empty field folded away', async function () {
  const line = this.form.emptyFieldsLine();
  await line.waitFor();
  assert.match(await line.innerText(), /\b1\b/);
  assert.equal(await line.getAttribute('aria-expanded'), 'false');
});

Then("the user does not see the parcel's note", async function () {
  assert.equal(await this.form.field('Note').count(), 0, 'the note is shown');
});

Then("the user sees the parcel's note", async function () {
  await this.form.field('Note').waitFor();
});

Then('the user sees when the parcel was created and who updated it on one line below its other fields', async function () {
  const foot = this.form.footLine();
  await foot.waitFor();
  const text = await foot.innerText();
  assert.match(text, /Created On/);
  assert.match(text, /Updated By\s+kiosk/);
  const shown = await this.form.fieldLabels();
  assert.ok(!shown.includes('Created On') && !shown.includes('Updated By'), `the fields still include ${shown.join(', ')}`);
  const footTop = (await foot.boundingBox()).y;
  const lastField = (await this.form.field(shown[shown.length - 1]).boundingBox());
  assert.ok(footTop >= lastField.y + lastField.height - 1, 'the line is not below the other fields');
});

Then("the user sees each of the parcel's fields marked with its type", async function () {
  for (const label of await this.form.fieldLabels())
    assert.ok(await this.form.typeMarkOf(label), `${label} has no type mark`);
  assert.equal(await this.form.typeMarkOf('Weight'), 'number');
  assert.equal(await this.form.typeMarkOf('Fragile'), 'yesno');
});

Then("the user sees the parcel's weight in even-width figures", async function () {
  const weight = await this.form.valueOf('Weight');
  assert.match(weight.text, /^2\.5/);
  assert.ok(weight.evenFigures, 'the weight is not in even-width figures');
});

Then('the user sees the parcel marked as fragile', async function () {
  const fragile = await this.form.valueOf('Fragile');
  assert.equal(fragile.kind, 'yesno');
  assert.equal(fragile.text, 'Yes');
});

Then("the user sees the parcel's rack as {string}", async function (title) {
  const rack = this.form.field('Rack').locator('[data-value]');
  await rack.getByText(title, { exact: true }).waitFor({ timeout: 10_000 });
  assert.ok((await this.form.valueOf('Rack')).link, 'the rack is not a link');
});

Then("the user sees the parcel's photo as the file {string}", async function (file) {
  const photo = await this.form.valueOf('Photo');
  assert.equal(photo.kind, 'file');
  assert.equal(photo.text, file);
});

Then(/^the user sees the parcel's (\w[\w ]*) grouped with the (numbers|links|text|dates|files)$/, async function (label, group) {
  assert.equal(await this.form.groupOf(label), GROUPS[group]);
});

Then("the user sees the parcel's note after every filled field", async function () {
  const shown = await this.form.fieldLabels();
  assert.equal(shown[shown.length - 1], 'Note', `the fields read ${shown.join(', ')}`);
});

Then("the user sees the parcel's Rack before every other field", async function () {
  const shown = await this.form.fieldLabels();
  assert.equal(shown[0], 'Rack', `the fields read ${shown.join(', ')}`);
});

Then("the user sees each of the parcel's fields below the one before", async function () {
  const lefts = await this.form.fieldLefts();
  assert.ok(lefts.length > 1);
  assert.ok(lefts.every((left) => left === lefts[0]), `the fields start at ${lefts.join(', ')}`);
});

Then("the user sees its fields in the builder's two sections", async function () {
  const first = this.form.section(0);
  const second = this.form.section(1);
  await first.locator('[data-form-field][data-label="Sender"]').waitFor();
  await first.locator('[data-form-field][data-label="Handed In On"]').waitFor();
  await second.locator('[data-form-field][data-label="Weight"]').waitFor();
  await second.locator('[data-form-field][data-label="Shelf Note"]').waitFor();
});
