'use strict';

// Steps for one-line text on a connected table (external-data-sources). The
// example is one parcel on a rack in the run's outside database; every value
// is made up. Arranging a row's fields (core-forms, #795) runs as Vitest tests
// (#1070, apps/web/test/scenarios/core-forms.test.tsx).

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { externalSql } = require('../support/stack');
const { givenReaderSource } = require('../support/outside-db');
const { FormPage } = require('../support/pages/form-page');

const SCHEMA = 'parcel_fixture';
const SOURCE = 'parcels';
const PARCEL = '7';

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

// ---- When ----

When('the user opens that parcel', async function () {
  this.form = new FormPage(await this.actor());
  await this.form.openRow('Parcel', PARCEL);
});

// ---- Then ----

Then('the user sees its sender on one line', async function () {
  const sender = await this.form.valueOf('Sender');
  assert.equal(sender.text, 'Front desk');
  assert.ok(sender.oneLine, 'the sender wraps like long text');
});

Then('the user sees its instructions as long text', async function () {
  const instructions = await this.form.valueOf('Instructions');
  assert.ok(!instructions.oneLine, 'the instructions are cut to one line');
});
