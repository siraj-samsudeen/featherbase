'use strict';

// jeyarama-assets-tagging: the JRA tag series, the fresh count sheet, area close, SAP matching
// and exception approval. "it is refused" lives in assets-shared.steps.js.

const assert = require('node:assert/strict');
const { After, Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');
const { counts } = require('../support/pages/assets-counts');

const both = world => { const flow = assets(world); return { flow, count: counts(flow) }; };

// A tag a scenario put on a register asset would be "already used" in the next one.
After(async function () {
  const count = this.assets?.counts;
  if (!count) return;
  for (const [table, id] of count.removeAfter.splice(0)) await count.remove(table, id);
});

// ---- The count freeze ----

/** A calendar day in India, `offset` days from today, as a date column stores it. */
const istDay = offset => new Date(Date.now() + 5.5 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

Given("ATK 1501's count freeze runs from yesterday to tomorrow", async function () {
  const { count } = both(this);
  await count.plan({ kind: 'Fresh inventory', site: 'ATK 1501', extra: { freeze_from: istDay(-1), freeze_to: istDay(1) } });
  const stored = await count.current();
  assert.deepEqual([String(stored.freeze_from).slice(0, 10), String(stored.freeze_to).slice(0, 10)], [istDay(-1), istDay(1)]);
});

When("a manager requests a transfer out of ATK 1501 without the site manager's note", async function () {
  const { flow, count } = both(this);
  await flow.save('a manager', 'equipment.transfer', {
    transfer_kind: 'Between sites', from_place: await count.site('ATK 1501'), to_place: await flow.place('Enchakkal WH 9151'), reason: 'Spare scale for the warehouse',
  }, true);
});

Then('it is refused, saying ATK 1501 is in its count freeze', function () {
  assets(this).refused(/ATK 1501 is in its count freeze/);
});

// ---- One permanent tag series ----

Given('JRA-000123 is on the dairy chiller', async function () {
  const { flow, count } = both(this);
  const tag = await count.issuedTag(123);
  await count.freeTag(tag);
  await count.site('ATK 1501');
  const id = await flow.asset('dairy chiller', 'ATK 1501', { tag_no: tag });
  count.removeAfter.push(['equipment.asset', id]);
  assert.equal((await flow.get('equipment.asset', id)).tag_no, tag);
});

When('a counter records another item with JRA-000123', async function () {
  const { count } = both(this);
  await count.extra('a counter', ['Assets Member']);
  await count.area('Bakery');
  await count.freshCount(['a counter', 'another member']);
  await count.line('a counter', { tag: 'JRA-000123', taggedBy: 'another member', area: 'Bakery', asset_name: 'Bread rack' }, true);
});

Then('the line is refused, saying tag numbers are never reused', async function () {
  const { flow, count } = both(this);
  flow.refused(/tag numbers are never reused/);
  assert.deepEqual(await flow.list('equipment.count_line', [['count', '=', count.count.row_id]], ['row_id']), []);
});

// ---- Record a fresh count line by area ----

Given('Ravi and Meena count ATK area GF-A03', async function () {
  const { count } = both(this);
  await count.area('GF-A03');
  await count.freshCount(['Ravi', 'Meena']);
});

When('Meena records JRA-000123 tagged by Ravi', async function () {
  const { count } = both(this);
  const tag = await count.issuedTag(123);
  await count.freeTag(tag);
  count.recorded = await count.line('Meena', { tag, taggedBy: 'Ravi', area: 'GF-A03' });
});

Then('the line shows tagged by Ravi and recorded by Meena', async function () {
  const { flow, count } = both(this);
  const stored = await flow.get('equipment.count_line', count.recorded.row_id);
  assert.equal(stored.tag_no, 'JRA-000123');
  assert.equal(stored.tagged_by, flow.ids.Ravi);
  assert.equal(stored.recorded_by, flow.ids.Meena);
  assert.match(await count.freshLines('Meena', 'GF-A03'), /JRA-000123[^\n]*Tagged Ravi · recorded Meena/);
});

// ---- Close an area each day ----

Given('{int} tagged lines and no spoiled labels in GF-A03 today', async function (number) {
  const { flow, count } = both(this);
  await count.area('GF-A03');
  await count.extra('the site manager', ['Assets Member']);
  await count.siteManager('the site manager');
  await count.freshCount(['Ravi', 'Meena']);
  for (let n = 0; n < number; n++) await count.line('Meena', { tag: await count.freshTag(), taggedBy: 'Ravi', area: 'GF-A03' });
  assert.deepEqual(await flow.list('equipment.tag_event', [['count', '=', count.count.row_id]], ['row_id']), []);
});

When('the site manager signs with {int} labels used', async function (labels) {
  const { flow, count } = both(this);
  await flow.save('the site manager', 'equipment.area_close', { count: count.count.row_id, area: flow.places['GF-A03'], labels_used: labels }, true);
});

Then('it is refused, saying to find the difference first', async function () {
  const { flow, count } = both(this);
  flow.refused(/find the difference before signing/);
  assert.deepEqual(await flow.list('equipment.area_close', [['count', '=', count.count.row_id]], ['row_id']), []);
});

// ---- Match the SAP book separately from counting ----

Given('Ravi counted at ATK 1501', async function () {
  const { count } = both(this);
  await count.area('Dairy');
  await count.freshCount(['Ravi', 'Meena']);
  count.counted = await count.line('Meena', { tag: await count.freshTag(), taggedBy: 'Ravi', area: 'Dairy', serial_no: 'BS23K44871' });
});

When('Ravi matches a SAP record', async function () {
  const { flow, count } = both(this);
  // Ravi is also an asset accountant, so only having counted can stop him.
  await count.addRole('Ravi', 'Assets Accountant');
  await count.financeRole('Ravi', 'Asset accountant');
  // Another asset accountant holds the plant's SAP book.
  await count.addRole('the asset accountant', 'Assets Accountant');
  const record = await flow.save('the asset accountant', 'equipment.sap_book', { plant: '1501', sap_asset_no: '200014', sap_asset_sub: '0', description: 'Chiller 3-door', book_value: 142000, quantity: 1 });
  await flow.act('Ravi', 'match_sap', { sap_book: record.row_id, lines: [count.counted.row_id], method: 'Serial number' }, true);
  flow.refused(/The count team never matches/);
});

// ---- Approve exceptions independently ----

Given('an {string} exception raised by the asset accountant', async function (outcome) {
  const { flow, count } = both(this);
  await count.addRole('the asset accountant', 'Assets Accountant');
  await count.financeRole('the asset accountant', 'Asset accountant');
  count.exception = await flow.save('the asset accountant', 'equipment.exception', { outcome, sap_asset_no: '200081-0', detail: 'EAS gate pair not found in any area' });
  assert.equal(count.exception.raised_by, flow.ids['the asset accountant']);
});

When('the asset accountant approves it', async function () {
  const { flow, count } = both(this);
  await flow.change('the asset accountant', 'equipment.exception', count.exception.row_id, { exception_state: 'Approved', approval_ref: 'FC/ATK/001' }, true);
  flow.refused(/an asset accountant never approves/);
});
