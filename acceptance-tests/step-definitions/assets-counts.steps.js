'use strict';

// asset-verification-counts: plan, start, count blind, record, review, recount, close, last verified.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');
const { counts } = require('../support/pages/assets-counts');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const both = world => { const flow = assets(world); return { flow, count: counts(flow) }; };

// ---- Plan a count ----

Given('ATK 1501 is a site', async function () {
  await counts(assets(this)).site('ATK 1501');
});

When('a manager plans a full count of ATK 1501 with Suresh counting and Meena reviewing', async function () {
  await counts(assets(this)).plan({ kind: 'Full', counters: ['Suresh'], reviewer: 'Meena' });
});

Then('the count is Planned, waiting to start', async function () {
  const { flow, count } = both(this);
  const stored = await count.current();
  assert.equal(stored.count_state, 'Planned');
  assert.equal(stored.snapshot_at, null);
  assert.equal(stored.reviewer, flow.ids.Meena);
  const counters = await flow.list('equipment.counter', [['count', '=', stored.row_id]], ['person']);
  assert.deepEqual(counters.map(row => row.person), [flow.ids.Suresh]);
  const row = await count.countsRow('a manager');
  assert.match(row.text, /Planned/);
  assert.ok(row.canStart, 'the count offers no Start count');
});

Given('Meena reviews the ATK count', async function () {
  await counts(assets(this)).plan({ counters: [], reviewer: 'Meena' });
});

When('a manager adds Meena as a counter', async function () {
  await counts(assets(this)).addCounter('a manager', 'Meena', true);
});

Then('the change is refused, saying the reviewer can’t also be a counter', async function () {
  const { flow, count } = both(this);
  flow.refused(/The reviewer can’t also be a counter/);
  assert.deepEqual(await flow.list('equipment.counter', [['count', '=', count.count.row_id]], ['row_id']), []);
});

// ---- Starting fixes what is expected ----

Given('ATK 1501 has {int} assets in the register', async function (number) {
  const flow = assets(this);
  await counts(flow).site('ATK 1501');
  for (let n = 1; n <= number; n++) await flow.asset(`ATK asset ${n}`, 'ATK 1501');
});

When('a manager starts the full count of ATK 1501', async function () {
  const { count } = both(this);
  await count.plan({ kind: 'Full' });
  count.startedFrom = Date.now();
  await count.start('a manager');
  count.startedTo = Date.now();
});

Then('the count is Counting, expecting {int} assets, fixed at that time', async function (number) {
  const { flow, count } = both(this);
  const stored = await count.current();
  assert.equal(stored.count_state, 'Counting');
  assert.equal(stored.expected_total, number);
  const fixedAt = Date.parse(stored.snapshot_at);
  assert.ok(fixedAt >= count.startedFrom - 1000 && fixedAt <= count.startedTo + 1000, `fixed at ${stored.snapshot_at}`);
  assert.equal((await count.expected()).length, number);
  // Fixed: an asset added to the place afterwards is not expected.
  await flow.asset('Bought after the start', 'ATK 1501');
  assert.equal((await count.expected()).length, number);
  assert.match((await count.countsRow('a manager')).text, new RegExp(`Counting · ${number} expected`));
});

// ---- Counters count blind ----

Given('Suresh counts the ATK count', async function () {
  const { flow, count } = both(this);
  await count.area('Dairy aisle');
  await count.site('Enchakkal WH 9151');
  await count.area('Cold store', 'Enchakkal WH 9151');
  await flow.asset('Display chiller', 'Dairy aisle');
  await flow.asset('Weighing scale', 'ATK 1501');
  await count.plan({ counters: ['Suresh'] });
  await count.start();
});

When('he asks for the count\'s expected list', async function () {
  await counts(assets(this)).askExpected('Suresh');
});

Then('he is refused', function () {
  assets(this).refused();
});

Then('his count page shows only his areas and how many he has recorded', async function () {
  const { count } = both(this);
  const { areas, text } = await count.counterPage('Suresh', 'Dairy aisle');
  assert.ok(areas.length > 0 && areas.every(label => label.startsWith('ATK 1501')), `areas offered: ${areas.join(', ')}`);
  assert.match(text, /You have recorded 0 items in ATK 1501 › Dairy aisle|You have recorded 0 items in .*Dairy aisle/);
  assert.doesNotMatch(text, /Display chiller|Weighing scale|expected/i);
});

// ---- Record what is found ----

Given('the ATK count is Counting and Suresh counts it', async function () {
  const { flow, count } = both(this);
  await count.area('Dairy aisle');
  await flow.asset('display chiller', 'Dairy aisle');
  await count.plan({ counters: ['Suresh'] });
  await count.start();
  assert.equal((await count.current()).count_state, 'Counting');
});

When('he records the display chiller in ATK Dairy aisle as Damaged', async function () {
  const { count } = both(this);
  count.recordedFrom = Date.now();
  count.recorded = await count.record('Suresh', { asset: 'display chiller', area: 'Dairy aisle', outcome: 'Damaged' });
  count.recordedTo = Date.now();
});

Then('the record keeps Suresh, the time, Dairy aisle and Damaged', async function () {
  const { flow, count } = both(this);
  const [stored] = (await count.scans()).filter(scan => scan.row_id === count.recorded.row_id);
  assert.equal(stored.created_by, flow.ids.Suresh);
  const at = Date.parse(stored.created_at);
  assert.ok(at >= count.recordedFrom - 1000 && at <= count.recordedTo + 1000, `recorded at ${stored.created_at}`);
  assert.equal(stored.area, flow.places['Dairy aisle']);
  assert.equal(stored.outcome, 'Damaged');
  assert.equal(stored.asset, flow.assets['display chiller']);
});

/** A counting ATK count with Suresh on it and the billing PC in the register. */
async function billingPcCount(world) {
  const { flow, count } = both(world);
  await count.site('ATK 1501');
  await flow.asset('billing PC', 'ATK 1501');
  await count.plan({ counters: ['Suresh'] });
  await count.start();
  return count;
}

Given('the billing PC’s label is torn', async function () {
  await billingPcCount(this);
});

When('Suresh types its tag without a reason', async function () {
  await counts(assets(this)).typeTag('Suresh', 'billing PC', 'ATK 1501', null, true);
});

Then('the record is refused, asking why the tag was typed', async function () {
  const { flow, count } = both(this);
  flow.refused(/Say why the tag was typed/);
  assert.deepEqual(await count.scans(), []);
});

Given('Suresh recorded the billing PC once', async function () {
  const count = await billingPcCount(this);
  count.first = await count.record('Suresh', { asset: 'billing PC', area: 'ATK 1501' });
  assert.equal(count.first.duplicate, false);
});

When('he records it again in the same count', async function () {
  const { count } = both(this);
  count.second = await count.record('Suresh', { asset: 'billing PC', area: 'ATK 1501' });
});

Then('the second record is flagged as a duplicate', async function () {
  const { count } = both(this);
  const stored = await count.scans();
  assert.equal(stored.find(scan => scan.row_id === count.second.row_id).duplicate, true);
  assert.equal(stored.find(scan => scan.row_id === count.first.row_id).duplicate, false);
});

// ---- Review, recount and close ----

/** A started ATK count expecting the weighing scale (and the forklift), counted by Suresh and reviewed by Meena. */
async function expecting(world, names) {
  const { flow, count } = both(world);
  await count.site('ATK 1501');
  for (const name of names) await flow.asset(name, 'ATK 1501');
  await count.plan({ counters: ['Suresh'], reviewer: 'Meena' });
  await count.start();
  const expected = await count.expected();
  for (const name of names) assert.ok(expected.includes(flow.assets[name]), `${name} is not expected`);
  return count;
}

Given('the ATK count expected the weighing scale and the forklift', async function () {
  await expecting(this, ['weighing scale', 'forklift']);
});

Given('the forklift was moved to Enchakkal after the count started', async function () {
  const { flow, count } = both(this);
  await flow.change('a manager', 'equipment.asset', flow.assets.forklift, { place: await count.site('Enchakkal') });
});

When('neither is recorded', async function () {
  const { count } = both(this);
  assert.deepEqual(await count.scans(), []);
  await count.moveTo('In review');
});

Then('the review shows the scale as missing and the forklift as moved since the start', async function () {
  const review = await counts(assets(this)).review('Meena');
  assert.match(review.missing, /weighing scale/);
  assert.doesNotMatch(review.missing, /forklift/);
  assert.match(review.moved, /forklift · now in Enchakkal/);
  assert.doesNotMatch(review.moved, /weighing scale/);
});

Given('the weighing scale is missing in the ATK review', async function () {
  const count = await expecting(this, ['weighing scale']);
  await count.moveTo('In review');
  assert.match((await count.review('Meena')).missing, /weighing scale/);
});

When('the reviewer sends it back for recount and Suresh then finds it', async function () {
  const { count } = both(this);
  await count.decide('Meena', 'weighing scale', 'Recount');
  await count.record('Suresh', { asset: 'weighing scale', area: 'ATK 1501', outcome: 'Found here' });
});

Then('the scale shows as found', async function () {
  const review = await counts(assets(this)).review('Meena');
  assert.match(review.found, /weighing scale · Found here/);
  assert.doesNotMatch(review.missing, /weighing scale/);
});

Given('the ATK review has one missing line without a decision', async function () {
  const count = await expecting(this, ['weighing scale']);
  await count.moveTo('In review');
  const { flow } = both(this);
  assert.deepEqual(await flow.list('equipment.count_decision', [['count', '=', count.count.row_id]], ['row_id']), []);
});

When('the reviewer closes the count', async function () {
  await counts(assets(this)).moveTo('Closed', 'Meena', true);
});

Then('closing is refused, saying every missing and unlisted line needs a decision', async function () {
  const { flow, count } = both(this);
  flow.refused(/Decide every missing and unlisted line before closing/);
  assert.equal((await count.current()).count_state, 'In review');
});

// ---- Last verified ----

Given('Suresh recorded the display chiller as Damaged in the ATK count on {int} {word} {int}', async function (day, month, year) {
  const { flow, count } = both(this);
  await count.area('Dairy aisle');
  await flow.asset('display chiller', 'Dairy aisle');
  await count.plan({ counters: ['Suresh'] });
  await count.start();
  const scan = await count.record('Suresh', { asset: 'display chiller', area: 'Dairy aisle', outcome: 'Damaged' });
  const monthIndex = MONTHS.indexOf(month);
  assert.ok(monthIndex >= 0, `no month called ${month}`);
  // Midday in India on that day: the platform stamps records with its own clock.
  await count.backdate(scan.row_id, new Date(Date.UTC(year, monthIndex, day, 6, 30)).toISOString());
});

When('anyone opens the chiller’s page', async function () {
  const flow = assets(this);
  counts(flow).shown = await flow.pageText('a member', `asset=${encodeURIComponent(flow.assets['display chiller'])}`);
});

Then('it shows last verified {word}, {word}, in the ATK count', async function (day, outcome) {
  const { count } = both(this);
  const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(count.shown, new RegExp(`Last verified ${escape(day)} · ${escape(outcome)} · ${escape(count.count.count_name)}`));
});
