'use strict';

// openspec/changes/tasker-issues-and-sla/specs/tasker-issues: raising an issue,
// its SLA clocks, escalation at breach, pausing only with approval, and
// verified closure.
//
// Issue clocks run on the server's time. A scenario that says when something
// happens sets the app's clock (support/app-clock.js) and moves it on; then
// the escalation job, which re-checks open issues every minute, runs.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { TaskerSetup, taskerAs, dayFrom } = require('../support/tasker');
const { setAppClock, appNow } = require('../support/app-clock');

// The day the scenarios' issues are raised, and the store hours' time zone.
const RAISED_ON = '2026-11-04';
const IST = '+05:30';
const MINUTE = 60_000;

const at = (day, time) => `${day}T${time}:00${IST}`;

/** "06-Nov-2026 10:00 IST" -> a Date. */
function istInstant(text) {
  const [, day, month, year, time] = text.match(/(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}:\d{2}) IST/);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return new Date(at(`${year}-${String(months.indexOf(month) + 1).padStart(2, '0')}-${day}`, time));
}

/** An issue raised at ATK Avadi at 10:00 on the raising day, by the System Manager, with these people and values. */
async function raisedIssue(world, title, { store = 'ATK Avadi', ...values } = {}) {
  const tasker = await TaskerSetup.of(world);
  await setAppClock(world, at(RAISED_ON, '10:00'));
  const where = await tasker.store(store);
  return tasker.raise(title, { store: where.row_id, ...values });
}

/** Moves the app's clock on to half an hour past the issue's fix deadline. */
async function pastFixTime(world) {
  const issue = await world.tasker.issueRow();
  await setAppClock(world, new Date(Date.parse(issue.fix_by) + 30 * MINUTE));
  await world.tasker.escalationRun();
}

Given('{member} is a Tasker member', async function (name) {
  const tasker = await TaskerSetup.of(this);
  await tasker.member(name);
  this.she = name;
});

When(/^she raises an? (Critical|High|Medium|Low) "([^"]*)" issue at (.+) for "([^"]*)"$/, async function (severity, category, store, asset) {
  const tasker = await TaskerSetup.of(this);
  await tasker.store(store);
  const title = `${asset}: ${category}`;
  const page = await taskerAs(this, this.she);
  await page.openIssues();
  await page.raiseIssue({ title, category, severity, store, asset });
  await tasker.findIssue(title);
  this.taskerPage = page;
});

Then('the issue is open with a response deadline and a fix deadline', async function () {
  const title = this.tasker.issue.issue_title;
  const page = this.taskerPage;
  await page.openIssues();
  await page.openIssue(title);
  const { response, resolution } = await page.issueClocks();
  const respondBy = istInstant(response.match(/Respond by (.+? IST)/)[1]);
  const fixBy = istInstant(resolution.match(/Fix by (.+? IST)/)[1]);
  assert.ok(respondBy > appNow(this) - MINUTE, `the response deadline ${respondBy.toISOString()} is already past`);
  assert.ok(fixBy > respondBy, `the fix deadline ${fixBy.toISOString()} is not after the response deadline`);
});

Given(/^an? (Critical|High|Medium|Low) issue is raised at (\d\d:\d\d) with a fix time of (\d+) days? in store hours from (\d\d:\d\d) to (\d\d:\d\d)$/,
  async function (severity, time, days, opens, closes) {
    const tasker = await TaskerSetup.of(this);
    await tasker.slaRule(severity, { respond_minutes: 60, fix_minutes: Number(days) * 1440, clock: 'Store hours' });
    await tasker.store('ATK Avadi', { opens_at: opens, closes_at: closes });
    await setAppClock(this, at(RAISED_ON, time));
    await tasker.raise('Freezer door seal torn', { severity, store: tasker.stores.get('ATK Avadi').row_id });
  });

Then(/^its time on the clock at (\d\d:\d\d) next morning is (\d+) hours?$/, async function (time, hours) {
  await setAppClock(this, at(dayFrom(RAISED_ON, 1), time));
  await this.tasker.escalationRun();
  const page = await taskerAs(this, 'a member');
  const said = await page.waitOnTheClock(this.tasker.issue.issue_title, `${hours}h`);
  assert.equal(said, `${hours}h`);
});

Given(/^an? (Critical|High|Medium|Low) issue at (.+) owned by (Meena|Ravi|Suresh|Kumar) in (.+)$/, async function (severity, store, owner, ownerFunction) {
  const tasker = await TaskerSetup.of(this);
  const { id } = await tasker.member(owner);
  await raisedIssue(this, 'Dairy chiller 2 at 9°C', { store, severity, owner: id, owner_function: ownerFunction });
});

Given(/^(.+)'s store manager is (Meena|Ravi|Suresh|Kumar) and the (.+) head is (Meena|Ravi|Suresh|Kumar)$/, async function (store, manager, ownerFunction, head) {
  const tasker = await TaskerSetup.of(this);
  await tasker.store(store, { store_manager: (await tasker.member(manager)).id });
  await tasker.functionHead(ownerFunction, (await tasker.member(head)).id);
  this.notified = [manager, head];
});

When('its fix time passes without submission', async function () {
  await pastFixTime(this);
});

Then(/^(Meena|Ravi|Suresh|Kumar) and (Meena|Ravi|Suresh|Kumar) are notified once and the issue shows it is breached$/, async function (first, second) {
  const tasker = this.tasker;
  const title = tasker.issue.issue_title;
  // Two more minutes pass, each checked by the escalation job: a breach is
  // told once, not at every check.
  for (let minute = 0; minute < 2; minute += 1) {
    await setAppClock(this, new Date(appNow(this).getTime() + MINUTE));
    await tasker.escalationRun();
  }
  for (const name of [first, second]) {
    const page = await taskerAs(this, name);
    await page.openIssues();
    assert.equal((await page.noticesFor(title, 'breach')).length, 1, `${name}'s breach notices`);
    assert.match(await page.issueClockChip(title), /^Breached by /);
  }
  const page = await taskerAs(this, first);
  await page.openIssues();
  await page.openIssue(title);
  const log = await page.issueLog('breach');
  assert.equal(log.length, 1, `breach entries in the log: ${JSON.stringify(log)}`);
  assert.match(log[0], new RegExp(`notice to .*${first}`));
  assert.match(log[0], new RegExp(`notice to .*${second}`));
});

Given(/^(Meena|Ravi|Suresh|Kumar) asks to pause an issue while waiting for the vendor$/, async function (owner) {
  const tasker = await TaskerSetup.of(this);
  const { id } = await tasker.member(owner);
  // The store has a manager who could approve the pause.
  await tasker.store('ATK Avadi', { store_manager: (await tasker.member('Meena')).id });
  await raisedIssue(this, 'Dairy chiller 2 at 9°C', { owner: id });
  const asked = await tasker.save('tasker.issue',
    { row_id: tasker.issue.row_id, pause_requested: true, pause_reason: 'Waiting for the vendor', pause_review_on: dayFrom(RAISED_ON, 2) },
    await tasker.as(owner));
  assert.equal(asked.pause_requested, true);
  assert.equal(asked.on_clock_minutes, 0);
  this.owner = owner;
});

When('the store manager has not approved it', async function () {
  assert.equal((await this.tasker.issueRow()).paused, false);
  // Two hours of store time go by with the pause still only asked for.
  await setAppClock(this, new Date(appNow(this).getTime() + 120 * MINUTE));
  await this.tasker.escalationRun();
});

Then("the issue's clock keeps running", async function () {
  const page = await taskerAs(this, this.owner);
  const said = await page.waitOnTheClock(this.tasker.issue.issue_title, '2h');
  assert.equal(said, '2h');
  const status = await page.issueStatusLines();
  assert.ok(status.some((line) => line.startsWith('Pause asked for · the clock runs until the store manager approves')), JSON.stringify(status));
  assert.ok(!status.some((line) => line.startsWith('Paused since')), JSON.stringify(status));
});

Given('an issue breached its fix time', async function () {
  const tasker = await TaskerSetup.of(this);
  const owner = await tasker.member('Suresh');
  const verifier = await tasker.member('Meena');
  await raisedIssue(this, 'Dairy chiller 2 at 9°C', { owner: owner.id, verifier: verifier.id });
  await pastFixTime(this);
  assert.equal((await tasker.issueRow()).fix_breached, true, 'the issue did not breach');
});

When('it is submitted and accepted', async function () {
  const title = this.tasker.issue.issue_title;
  const owner = await taskerAs(this, 'Suresh');
  await owner.openIssues();
  await owner.openIssue(title);
  await owner.submitIssue('Compressor relay replaced; 3°C after an hour');
  const verifier = await taskerAs(this, 'Meena');
  await verifier.openIssues();
  await verifier.openIssue(title);
  await verifier.acceptIssue();
  this.taskerPage = verifier;
});

Then('it is closed and still shows it breached', async function () {
  const title = this.tasker.issue.issue_title;
  const page = this.taskerPage;
  await page.openIssues();
  await page.showClosedIssues();
  assert.equal(await page.issueClockChip(title, true), 'Closed · fix time was breached');
  await page.openIssue(title, true);
  assert.match(await page.issueDetailText(), /Fix time breached \d{2}-[A-Z][a-z]{2}-\d{4}/);
  assert.match((await page.issueClocks()).verification, /Verified by Meena/);
});
