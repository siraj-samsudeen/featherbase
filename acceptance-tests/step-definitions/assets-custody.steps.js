'use strict';

// asset-custody-and-transfers: issuing, returning, clearances, transfers and an asset's history.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');
const { custody, PC, HOUR } = require('../support/pages/assets-custody');

const ACS = ['Voltas AC 1', 'Voltas AC 2'];
const AC = 'Voltas AC';
const DG = 'Kirloskar DG';
const MONTH = { November: '11' };
const isoDay = (day, month, year) => `${year}-${MONTH[month]}-${String(day).padStart(2, '0')}`;
const shownDay = (day, month, year) => `${String(day).padStart(2, '0')}-${month.slice(0, 3)}-${year}`;
const SHOWN_DATE = /\d{2}-[A-Z][a-z]{2}-\d{4}/;

function flows(world) {
  const flow = assets(world);
  return { flow, c: custody(flow) };
}

async function suresholdsPc(world) {
  const { c } = flows(world);
  await c.issue(PC, 'Suresh');
  await c.answer('Suresh', 'Accepted');
}

// ---- Issue and accept ----

Given('a manager issues the billing PC to Suresh', async function () {
  await flows(this).c.issue(PC, 'Suresh');
});

Given('the billing PC is issued to Suresh and waiting', async function () {
  const { c } = flows(this);
  await c.issue(PC, 'Suresh');
  assert.equal((await c.custodyRow()).custody_state, 'Pending');
});

When('Suresh accepts it', async function () {
  await flows(this).c.pressOnMine('Suresh', PC, 'Accept', 'Accepted');
});

When('another member tries to accept it', async function () {
  await flows(this).c.answer('another member', 'Accepted', true);
});

Then('the billing PC is with Suresh, accepted', async function () {
  const { c } = flows(this);
  const facts = await c.assetFacts('a manager', PC);
  assert.equal(facts.Custodian, 'Suresh');
  assert.equal(facts.Custody, 'With custodian');
  assert.equal((await c.custodyRow()).custody_state, 'Accepted');
  const entries = await c.movements('a manager', PC);
  assert.ok(entries.some(e => e.includes('Issued to Suresh · Accepted')), entries.join('\n'));
});

Then('the answer is refused, saying only Suresh can answer', async function () {
  const { flow, c } = flows(this);
  flow.refused(/Only the person it was issued to can answer/);
  assert.equal((await c.custodyRow()).custody_state, 'Pending');
});

// ---- Return ----

Given('Suresh holds the billing PC', async function () {
  await suresholdsPc(this);
});

When('he hands it back and a manager accepts the return', async function () {
  const { c } = flows(this);
  await c.pressOnMine('Suresh', PC, 'Hand back', 'Hand-back requested');
  await c.takeBack('a manager', PC, 'Accept return');
});

Then('the billing PC is at its location with no custodian', async function () {
  const { flow, c } = flows(this);
  const facts = await c.assetFacts('a manager', PC);
  assert.equal(facts.Custody, 'At location');
  assert.equal(facts.Custodian, '—');
  const asset = await flow.get('equipment.asset', flow.assets[PC]);
  assert.equal(asset.place, await flow.place('ATK 1501'));
  assert.equal(asset.custodian, null);
});

// ---- Clearances ----

Given('Suresh is leaving on {int} {word} {int} and still holds the billing PC', async function (day, month, year) {
  await suresholdsPc(this);
  await flows(this).c.openClearance('Suresh', isoDay(day, month, year));
});

Given('Suresh left on {int} {word} {int} and still holds the billing PC', async function (day, month, year) {
  await suresholdsPc(this);
  const { c } = flows(this);
  await c.openClearance('Suresh', isoDay(day, month, year));
  c.leavingDay = shownDay(day, month, year);
});

When('a manager tries to close his clearance', async function () {
  await flows(this).c.closeClearance('a manager', true);
});

Then('closing is refused until the PC is returned or reassigned', async function () {
  const { flow, c } = flows(this);
  flow.refused(/Return or reassign every asset before clearing/);
  assert.equal((await flow.get('equipment.clearance', c.clearance)).clearance_state, 'Open');
  // Once the PC is back, the same close goes through.
  await c.act('a manager', 'return_custody', { custody: c.custody });
  const closed = await c.closeClearance('a manager');
  assert.equal(closed.clearance_state, 'Cleared');
});

When('anyone opens his clearance on {int} {word} {int}', async function (day, month, year) {
  const { c } = flows(this);
  // Only Assets Managers see clearances; the page is read with the browser's calendar on that day.
  // The run's database keeps earlier runs' clearances, so every row for a Suresh leaving that day
  // is read, this scenario's among them.
  c.statuses = await c.clearanceStatuses('a manager', 'Suresh', c.leavingDay, isoDay(day, month, year));
});

Then('it shows that it needs escalation to HR and Operations', function () {
  const { c } = flows(this);
  assert.ok(c.statuses.length >= 1, 'his clearance is not listed');
  for (const status of c.statuses) assert.match(status, /^Escalate to HR and Operations: 1 asset not returned$/);
});

// ---- Request and approve ----

Given('Meena requests moving two ACs from ATK 1501 to Enchakkal WH 9151', async function () {
  await flows(this).c.request('Meena', ACS);
});

When('Meena approves her own request', async function () {
  await flows(this).c.decide('Meena', 'Approved', true);
});

Then('the approval is refused, saying someone else approves', async function () {
  const { flow, c } = flows(this);
  flow.refused(/Someone other than the requester approves a transfer/);
  assert.equal((await c.transferRow()).transfer_state, 'Requested');
});

Given('the AC is on an approved transfer', async function () {
  const { c } = flows(this);
  await c.request('Meena', [AC]);
  await c.decide('a manager', 'Approved');
});

When('a manager adds the AC to another transfer', async function () {
  const { flow, c } = flows(this);
  const other = await c.save('a manager', 'equipment.transfer',
    { transfer_kind: 'Within site', from_place: await flow.place('ATK 1501'), to_place: await flow.place('ATK 1501'), reason: 'Move to billing' });
  await c.save('a manager', 'equipment.transfer_line', { transfer: other.row_id, asset: flow.assets[AC] }, true);
});

Then('it is refused, saying the AC is already on a transfer', function () {
  assets(this).refused(new RegExp(`${AC} is already on transfer TRF-`));
});

// ---- Dispatch ----

Given('the transfer of two ACs is approved', async function () {
  const { c } = flows(this);
  await c.request('a manager', ACS);
  await c.decide('Meena', 'Approved');
});

When('Meena scans both out with transporter {string}', async function (transporter) {
  const { c } = flows(this);
  await c.scanOut('Meena', transporter);
  assert.equal((await c.transferRow()).transporter, transporter);
});

Then('both ACs are in transit, due within {int} days', async function (days) {
  const { c } = flows(this);
  for (const name of ACS) assert.equal((await c.assetFacts('Meena', name)).Custody, 'In transit');
  const transfer = await c.transferRow();
  assert.equal(Date.parse(transfer.expected_receipt_at) - Date.parse(transfer.dispatched_at), days * 24 * HOUR);
});

// ---- Receive ----

Given('two ACs are in transit to Enchakkal WH 9151', async function () {
  const { c } = flows(this);
  await c.request('Meena', ACS);
  await c.decide('a manager', 'Approved');
  await c.dispatch('Meena');
});

When('a manager receives one as good and one as damaged', async function () {
  await flows(this).c.receiveOnPage('a manager', { [ACS[0]]: 'Received good', [ACS[1]]: 'Received damaged' });
});

Then('both ACs are at Enchakkal WH 9151 and the damaged one shows condition Damaged', async function () {
  const { flow, c } = flows(this);
  const enchakkal = await flow.place('Enchakkal WH 9151');
  for (const name of ACS) assert.equal((await flow.get('equipment.asset', flow.assets[name])).place, enchakkal);
  assert.equal((await c.assetFacts('a manager', ACS[1])).Condition, 'Damaged');
  assert.notEqual((await c.assetFacts('a manager', ACS[0])).Condition, 'Damaged');
});

Given('a transfer between sites was dispatched {int} days ago and is not received', async function (days) {
  const { c } = flows(this);
  await c.request('Meena', ACS, { kind: 'Between sites' });
  await c.decide('a manager', 'Approved');
  const sent = await c.dispatch('Meena');
  // The server stamps the dispatch now; the page is then read as it looks that many days later.
  c.viewAt = new Date(Date.parse(sent.dispatched_at) + days * 24 * HOUR);
});

Then('it shows as late', async function () {
  const { c } = flows(this);
  assert.equal((await c.transferRow()).transfer_state, 'Dispatched');
  const clock = await c.receiptClockAt('a manager', c.viewAt);
  assert.match(clock, /^Late by /);
});

// ---- Between companies ----

Given('a transfer of the DG from JRPL to KAIPL is received', async function () {
  const { flow, c } = flows(this);
  await flow.asset(DG, 'ATK 1501', { owner_entity: await flow.entity('JRPL') });
  await c.request('a manager', [DG], { kind: 'Between companies', toEntity: 'KAIPL' });
  await c.decide('Meena', 'Approved');
  await c.dispatch('a manager');
  await c.receive('Meena', DG, 'Received good');
  assert.equal((await c.transferRow()).transfer_state, 'Received');
});

When('nobody has confirmed the SAP transaction', async function () {
  assert.equal((await flows(this).c.transferRow()).finance_confirmed_at, null);
});

Then('the DG is still owned by JRPL', async function () {
  const { c } = flows(this);
  assert.match((await c.assetFacts('a manager', DG))['Legal owner'], /^JRPL\b/);
});

Then('once Finance confirms SAP document {int} the DG is owned by KAIPL', async function (document) {
  const { c } = flows(this);
  // Finance's confirmation is recorded by someone other than the requester.
  await c.confirmFinanceOnPage('the asset accountant', String(document));
  assert.match((await c.assetFacts('a manager', DG))['Legal owner'], /^KAIPL\b/);
});

// ---- History ----

Given('the billing PC was issued to Suresh and later moved to Enchakkal WH 9151', async function () {
  const { c } = flows(this);
  await suresholdsPc(this);
  await c.request('a manager', [PC]);
  await c.decide('Meena', 'Approved');
  await c.dispatch('a manager');
  await c.receive('Meena', PC, 'Received good');
});

When('anyone opens its page', async function () {
  const { c } = flows(this);
  c.entries = await c.movements('a member', PC);
});

Then('it lists the issue to Suresh and the move to Enchakkal, each with its date', function () {
  const { entries } = flows(this).c;
  const issue = entries.find(e => e.includes('Issued to Suresh'));
  const move = entries.find(e => e.includes('→ Enchakkal WH 9151'));
  assert.ok(issue, `no issue to Suresh in:\n${entries.join('\n')}`);
  assert.ok(move, `no move to Enchakkal in:\n${entries.join('\n')}`);
  assert.match(issue, SHOWN_DATE);
  assert.match(move, SHOWN_DATE);
});
