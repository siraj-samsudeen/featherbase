'use strict';

// The asset-register spec.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');
const { Repairs, istLabel } = require('../support/pages/assets-repairs');

const COLD_ROOM = 'walk-in cold room';
const SAP_REFRESHED = '2026-11-07T04:30:00.000Z';

function register(world) {
  const flow = assets(world);
  world.register ??= { app: new Repairs(flow), flow };
  return world.register;
}

// ---- Keep one register of the group's assets ----

Given("ATK 1501 is one of the group's sites", async function () {
  const { flow } = register(this);
  const site = await flow.get('equipment.place', await flow.place('ATK 1501', 'Site'));
  assert.equal(site.place_level, 'Site');
});

When('a manager adds the {string} of type AC to ATK 1501 with tag {word}', async function (name, tag) {
  const state = register(this);
  const { flow, app } = state;
  const row = await app.addAsset('a manager', { asset_name: name, asset_type: await flow.type('AC'), place: await flow.place('ATK 1501'), tag_no: tag });
  state.assetId = row.row_id;
  state.assetName = name;
});

Then('the register lists the AC under tag {word}', async function (tag) {
  const { app, assetId, assetName } = register(this);
  assert.equal((await app.asset(assetId)).tag_no, tag);
  const row = await app.registerRow('a manager', assetId);
  assert.ok(row, 'the AC is in the register');
  assert.match(row.text, new RegExp(assetName));
  assert.equal(row.tag, tag);
});

Then('every member sees it in ATK 1501', async function () {
  const { app, assetId, assetName } = register(this);
  for (const member of ['a member', 'another member']) {
    const row = await app.registerRow(member, assetId, 'ATK 1501');
    assert.ok(row, `${member} sees the asset in ATK 1501`);
    assert.match(row.text, new RegExp(assetName));
    assert.match(row.text, /ATK 1501/);
  }
});

Given('the {string} in ATK 1501 has no tag yet', async function (name) {
  const state = register(this);
  state.assetId = await state.flow.asset(name, 'ATK 1501');
  assert.equal((await state.app.asset(state.assetId)).tag_no ?? null, null);
});

When('a member opens the register', async function () {
  const state = register(this);
  state.row = await state.app.registerRow('a member', state.assetId);
  assert.ok(state.row, 'the asset is in the register');
});

Then("the billing PC's tag reads {string}", function (tag) {
  assert.equal(register(this).row.tag, tag);
});

// ---- Places nest from site to area ----

Given('the Cold chain area is on the Ground floor of the Main building at Enchakkal WH 9151', async function () {
  const { flow } = register(this);
  await flow.place('Enchakkal WH 9151', 'Site');
  await flow.place('Main building', 'Building', 'Enchakkal WH 9151');
  await flow.place('Ground floor', 'Floor', 'Main building');
  await flow.place('Cold chain', 'Area', 'Ground floor');
});

When('a member opens the walk-in cold room in Cold chain', async function () {
  const state = register(this);
  state.assetId = await state.flow.asset(COLD_ROOM, 'Cold chain');
  state.shown = await state.app.openAsset('a member', state.assetId);
});

Then('its place reads {string}', function (path) {
  assert.ok(register(this).shown.includes(path), register(this).shown);
});

// ---- Each asset links to its SAP records ----

Given('the walk-in cold room is SAP asset {int}, sub-number {int}, equipment {int}', async function (assetNo, sub, equipment) {
  const state = register(this);
  state.sap = { assetNo: String(assetNo), sub: String(sub), equipment: String(equipment) };
  state.assetId = await state.flow.asset(COLD_ROOM, 'Enchakkal WH 9151', {
    sap_asset_no: state.sap.assetNo, sap_asset_sub: state.sap.sub, sap_equipment_no: state.sap.equipment, sap_refreshed_at: SAP_REFRESHED,
  });
});

When('a member opens it in Assets', async function () {
  const state = register(this);
  await state.app.openAsset('a member', state.assetId);
});

Then('the page shows those numbers as coming from SAP, with when they were refreshed', async function () {
  const { app, sap } = register(this);
  const { text } = await app.sapSection('a member');
  assert.ok(text.includes(`${sap.assetNo} / ${sap.sub}`), text);
  assert.ok(text.includes(sap.equipment), text);
  assert.ok(text.includes(`Refreshed ${istLabel(SAP_REFRESHED)}`), text);
});

Then('offers no way to change them', async function () {
  const { app } = register(this);
  assert.equal((await app.sapSection('a member')).controls, 0);
});

// ---- Ownership is recorded apart from location ----

Given('KAIPL is a Verified legal entity and Kannammal Agro is another', async function () {
  const { flow } = register(this);
  assert.equal((await flow.get('equipment.entity', await flow.entity('KAIPL', 'Verified'))).entity_status, 'Verified');
  await flow.entity('Kannammal Agro', 'Draft');
});

When('the walk-in cold room is owned by KAIPL and operated by Kannammal Agro', async function () {
  const state = register(this);
  const { flow } = state;
  state.assetId = await flow.asset(COLD_ROOM, 'Enchakkal WH 9151', { owner_entity: await flow.entity('KAIPL'), operator_entity: await flow.entity('Kannammal Agro') });
});

Then('its page shows both, with KAIPL marked Verified', async function () {
  const { app, assetId } = register(this);
  await app.openAsset('a member', assetId);
  const { owner, operator } = await app.ownership('a member');
  assert.equal(owner, 'KAIPL · Verified');
  assert.match(operator, /^Kannammal Agro · /);
});

// ---- Four states are kept apart ----

Given('the walk-in cold room is Capitalized and Under repair, With vendor', async function () {
  const state = register(this);
  state.assetId = await state.flow.asset(COLD_ROOM, 'Enchakkal WH 9151', { book_status: 'Capitalized', condition: 'Under repair', custody_status: 'With vendor' });
});

Given('it has an open repair job', async function () {
  const { app, assetId } = register(this);
  await app.report('store staff', assetId, 'Door seal torn');
});

Then('its page shows Books Capitalized, Condition Under repair, Custody With vendor and Workflow Repair job open', async function () {
  const { app, assetId } = register(this);
  await app.openAsset('a member', assetId);
  assert.deepEqual(await app.states('a member'), ['Books: Capitalized', 'Condition: Under repair', 'Custody: With vendor', 'Workflow: Repair job open']);
});

// ---- Only managers change the register ----

Given('the {string} is in the register', async function (name) {
  const state = register(this);
  state.assetId = await state.flow.asset(name, 'ATK 1501', { type: 'AC' });
});

When('store staff try to change its place', async function () {
  const { app, flow, assetId } = register(this);
  const before = (await app.asset(assetId)).place;
  await app.changeAsset('store staff', assetId, { place: await flow.place('Avadi Store') }, true);
  flow.refused();
  assert.equal((await app.asset(assetId)).place, before);
});

// ---- See what needs attention on an asset ----

Given('the {string} warranty ends on 30 November 2026', async function (name) {
  const state = register(this);
  state.assetId = await state.flow.asset(name, 'ATK 1501', { type: 'DG', warranty_until: '2026-11-30' });
});

Then('the register shows its warranty ends soon', async function () {
  const { app, assetId } = register(this);
  const row = await app.registerRow('a manager', assetId, null, this.today);
  assert.ok(row, 'the asset is in the register');
  assert.match(row.text, /Warranty ends soon/);
});
