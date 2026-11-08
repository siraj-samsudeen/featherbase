'use strict';

// The asset-repair-jobs spec. Assets stamps when a job was reported, responded to, started and
// restored from the server's own clock, so "at 10:00" anchors a scenario: later times are read
// relative to the stored report, and the page is read on a device whose clock shows that moment.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');
const { Repairs, istLabel, HOUR } = require('../support/pages/assets-repairs');

const AC = 'Voltas 2-ton split AC';
const COLD_ROOM = 'walk-in cold room';

function repairs(world) {
  const flow = assets(world);
  world.repairs ??= { app: new Repairs(flow), flow };
  return world.repairs;
}

/** The asset each spec job is reported on. */
async function assetFor(flow, problem) {
  return problem === 'Door seal torn' ? flow.asset(COLD_ROOM, 'Enchakkal WH 9151') : flow.asset(AC, 'ATK 1501', { type: 'AC' });
}

/** A job reported by store staff, then moved as the scenario needs. */
async function reported(world, problem, values = {}) {
  const state = repairs(world);
  state.assetId = await assetFor(state.flow, problem);
  state.problem = problem;
  state.job = await state.app.report('store staff', state.assetId, problem, values);
  return state;
}

async function fixedByRavi(world, problem) {
  const state = await reported(world, problem);
  const ravi = await state.flow.who('Ravi');
  await state.app.changeJob('a manager', state.job.row_id, { assigned_to: ravi });
  await state.app.changeJob('Ravi', state.job.row_id, { job_state: 'In progress' });
  await state.app.changeJob('Ravi', state.job.row_id, { job_state: 'Fixed', work_done: 'Replaced the start capacitor' });
  assert.equal((await state.app.job(state.job.row_id)).job_state, 'Fixed');
  return state;
}

// ---- Report a fault from the asset ----

Given('store staff open the {string} page', async function (name) {
  const state = repairs(this);
  state.assetId = await state.flow.asset(name, 'ATK 1501', { type: 'AC' });
  await state.app.openAsset('store staff', state.assetId);
});

When('they report {string} as {word}', async function (problem, priority) {
  await repairs(this).app.reportOnPage('store staff', problem, priority);
});

Then('a repair job {string} is waiting for the AC at ATK 1501', async function (problem) {
  const { app, flow, assetId } = repairs(this);
  const jobs = (await app.jobsOn(assetId)).filter(job => job.problem === problem);
  assert.equal(jobs.length, 1, `one "${problem}" job on the AC`);
  assert.equal(jobs[0].job_state, 'Reported');
  assert.equal(jobs[0].priority, 'Urgent');
  assert.equal(jobs[0].place, await flow.place('ATK 1501'));
  const shown = await app.openJobs('store staff');
  assert.match(shown, new RegExp(`${problem}\\s+Urgent · Reported`));
});

// ---- Every job has a fix-by time ----

Given('{string} was reported as {word} at 10:00', async function (problem, priority) {
  const state = await reported(this, problem, { priority });
  assert.equal(state.job.priority, priority);
});

When('it is 16:00 and the job is not fixed', async function () {
  const state = repairs(this);
  const job = await state.app.job(state.job.row_id);
  assert.notEqual(job.job_state, 'Fixed');
  state.now = Date.parse(job.reported_at) + 6 * HOUR;
});

Then('the job shows it is late by 2 hours', async function () {
  const { app, assetId, now } = repairs(this);
  await app.openAsset('store staff', assetId, now);
  assert.match(await app.openJobs('store staff'), /Late by 2h\b/);
});

When('a manager raises it to High', async function () {
  const { app, job } = repairs(this);
  await app.changeJob('a manager', job.row_id, { priority: 'High' });
});

Then('it is due for fixing at 10:00 the next day', async function () {
  const { app, assetId, job: before } = repairs(this);
  const job = await app.job(before.row_id);
  assert.equal(Date.parse(job.fix_by), Date.parse(job.reported_at) + 24 * HOUR);
  // Read at the moment it was reported, the clock shows exactly a day left.
  await app.openAsset('a manager', assetId, Date.parse(job.reported_at));
  assert.match(await app.openJobs('a manager'), /High · Reported\s+1d left/);
});

// ---- A job keeps its whole timeline ----

const TIMELINE = [['Stopped working', 'failure_started_at'], ['Reported', 'reported_at'], ['Responded', 'responded_at'], ['Repair started', 'repair_started_at'], ['Restored', 'restored_at']];

Given('{string} was reported, saying the cold room stopped 10 minutes earlier', async function (problem) {
  const state = await reported(this, problem, { failure_started_at: new Date(Date.now() - 10 * 60_000).toISOString() });
  const gap = Date.parse(state.job.reported_at) - Date.parse(state.job.failure_started_at);
  assert.ok(gap >= 10 * 60_000 && gap < 11 * 60_000, `stopped 10 minutes before it was reported, not ${gap} ms`);
});

When('Ravi is assigned, starts the repair and fixes it', async function () {
  const { app, flow, job } = repairs(this);
  await app.changeJob('a manager', job.row_id, { assigned_to: await flow.who('Ravi') });
  await app.changeJob('Ravi', job.row_id, { job_state: 'In progress' });
  await app.changeJob('Ravi', job.row_id, { job_state: 'Fixed', work_done: 'Replaced the door seal' });
});

Then('the job shows when the cold room stopped, was reported, was responded to, repair started and was restored, in that order', async function () {
  const state = repairs(this);
  const { app, flow, job } = state;
  const stored = await flow.get('equipment.job', job.row_id);
  const times = TIMELINE.map(([label, field]) => { assert.ok(stored[field], `${label} is recorded`); return Date.parse(stored[field]); });
  for (let index = 1; index < times.length; index += 1)
    assert.ok(times[index] >= times[index - 1], `${TIMELINE[index][0]} comes after ${TIMELINE[index - 1][0]}`);
  state.timeline = Object.fromEntries(TIMELINE.map(([, field]) => [field, stored[field]]));

  await app.openAsset('store staff', state.assetId);
  const page = await flow.page('store staff');
  const shown = page.getByRole('article', { name: job.problem }).getByRole('list', { name: 'Timeline' });
  const items = await shown.getByRole('listitem').allInnerTexts();
  assert.deepEqual(items.map(item => item.replace(/\s+/g, ' ').trim()), TIMELINE.map(([label, field]) => `${label} ${istLabel(stored[field])}`));
});

Then('none of those times changes when the job is saved again', async function () {
  const { app, flow, job, timeline } = repairs(this);
  await app.changeJob('Ravi', job.row_id, { cause: 'Seal perished', job_state: 'Fixed', work_done: 'Replaced the door seal' });
  const again = await flow.get('equipment.job', job.row_id);
  assert.equal(again.cause, 'Seal perished');
  for (const [label, field] of TIMELINE) assert.equal(again[field], timeline[field], `${label} did not move`);
});

// ---- Move a job from reported to fixed ----

Given('{string} is Reported', async function (problem) {
  const state = await reported(this, problem);
  assert.equal(state.job.job_state, 'Reported');
});

When('a manager assigns it to Ravi', async function () {
  const { app, flow, job } = repairs(this);
  await app.changeJob('a manager', job.row_id, { assigned_to: await flow.who('Ravi') });
});

Then('the job is Assigned to Ravi', async function () {
  const { app, flow, job: before, assetId } = repairs(this);
  const job = await app.job(before.row_id);
  assert.equal(job.job_state, 'Assigned');
  assert.equal(job.assigned_to, await flow.who('Ravi'));
  const card = await app.boardCard('a manager', assetId);
  assert.equal(card.column, 'Assigned');
  assert.match(card.text, /\bRavi\b/);
});

Given('{string} is Assigned to Ravi', async function (problem) {
  const state = await reported(this, problem);
  await state.app.changeJob('a manager', state.job.row_id, { assigned_to: await state.flow.who('Ravi') });
  assert.equal((await state.app.job(state.job.row_id)).job_state, 'Assigned');
});

When('store staff try to mark it Fixed', async function () {
  const { app, flow, job } = repairs(this);
  // With a note of the work, so only who is asking can refuse it.
  await app.changeJob('store staff', job.row_id, { job_state: 'Fixed', work_done: 'Replaced the start capacitor' }, true);
  flow.refused();
  assert.equal((await app.job(job.row_id)).job_state, 'Assigned');
});

// ---- A fixed job says what was done ----

Given('{string} is In progress', async function (problem) {
  const state = await reported(this, problem);
  await state.app.changeJob('a manager', state.job.row_id, { assigned_to: await state.flow.who('Ravi') });
  await state.app.changeJob('Ravi', state.job.row_id, { job_state: 'In progress' });
  assert.equal((await state.app.job(state.job.row_id)).job_state, 'In progress');
});

When('Ravi marks it Fixed without saying what was done', async function () {
  const { app, job } = repairs(this);
  await app.changeJob('Ravi', job.row_id, { job_state: 'Fixed' }, true);
});

Then('the change is refused, asking what was done', async function () {
  const { app, flow, job } = repairs(this);
  flow.refused(/Say what was done/);
  assert.equal((await app.job(job.row_id)).job_state, 'In progress');
});

// ---- The store confirms the repair ----

Given('Ravi fixed {string}', async function (problem) {
  await fixedByRavi(this, problem);
});

When('store staff confirm it works', async function () {
  const { app, assetId, problem } = repairs(this);
  await app.openAsset('store staff', assetId);
  await app.confirmOnPage('store staff', problem);
});

Then('the job is closed, with who confirmed it and when', async function () {
  const { app, flow, job, assetId, problem } = repairs(this);
  const confirmations = await app.confirmations(job.row_id);
  assert.equal(confirmations.length, 1);
  const [confirmation] = confirmations;
  assert.equal(confirmation.created_by, await flow.who('store staff'), 'store staff confirmed it');
  assert.ok(confirmation.created_at, 'when it was confirmed');
  const past = await app.pastJobs('store staff');
  assert.ok(past.includes(problem), past);
  assert.ok(past.includes(`Closed · confirmed ${istLabel(confirmation.created_at)}`), past);
  assert.equal((await app.boardCard('store staff', assetId)).column, 'Closed');
});

When('Ravi tries to confirm it', async function () {
  const { app, job } = repairs(this);
  await app.confirm('Ravi', job.row_id, true);
});

Then('the confirmation is refused', async function () {
  const { app, flow, job } = repairs(this);
  flow.refused(/Someone other than the technician/);
  assert.equal((await app.confirmations(job.row_id)).length, 0);
});

// ---- Check cover before paying for work ----

Given("the AC's warranty runs until 12 March 2027", async function () {
  const state = repairs(this);
  state.assetId = await state.flow.asset(AC, 'ATK 1501', { type: 'AC', warranty_until: '2027-03-12' });
});

When('{string} is opened on 7 November 2026', async function (problem) {
  const state = await reported(this, problem);
  state.now = Date.parse('2026-11-07T10:00:00+05:30');
});

Then('the job shows the AC is under warranty until 12-Mar-2027', async function () {
  const { app, assetId, now } = repairs(this);
  const card = await app.boardCard('Ravi', assetId, now);
  assert.match(card.text, /Under warranty until 12-Mar-2027/);
});
