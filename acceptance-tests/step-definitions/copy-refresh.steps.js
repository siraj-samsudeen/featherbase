'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { Api } = require('../support/api');
const { acceptanceSql } = require('../support/stack');
const { CopyRefreshFixture } = require('../support/copy-refresh-fixture');
const { CopyRefreshPage } = require('../support/pages/copy-refresh-page');

async function plants(world) {
  world.plants = new CopyRefreshFixture(await Api.asSystemManager());
  await world.plants.create();
}

Given('the user is a System Manager with a copied Plants table', async function () {
  await plants(this);
  this.refreshPage = new CopyRefreshPage(await this.asSystemManager());
  await this.refreshPage.open();
});

When('the user schedules Plants to refresh hourly', async function () {
  await this.refreshPage.schedule('hourly');
});

Then('Plants has one hourly schedule that the user can pause and change', async function () {
  const original = await this.plants.scheduleInfo();
  assert.equal(original.cadence, 'hourly');
  assert.equal(original.enabled, true);
  await this.refreshPage.open();
  assert.equal(await this.refreshPage.cadence(), 'hourly');
  await this.refreshPage.pause();
  await this.refreshPage.open();
  assert.equal(await this.refreshPage.cadence(), 'off');
  await this.refreshPage.schedule('daily');
  const changed = await this.plants.scheduleInfo();
  assert.equal(changed.row_id, original.row_id);
  assert.equal(changed.cadence, 'daily');
  assert.equal(changed.enabled, true);
});

Given('the user can read the copied Plants table but is not a System Manager', async function () {
  await plants(this);
  const role = await this.withApi(api => api.readerRoleFor('Plants'));
  await this.person('the user', [role]);
  this.refreshPage = new CopyRefreshPage(await this.actor());
  await this.refreshPage.open(true);
});

When('the user tries to schedule Plants to refresh hourly', async function () {
  this.refusal = await this.refreshPage.tryScheduling();
});

Then('the request is refused and Plants has no new schedule', async function () {
  assert.equal(this.refusal, 403);
  assert.equal(await this.plants.scheduleInfo(), null);
});

Given('the user corrected plant P01 in the copied Plants table', async function () {
  await plants(this);
  await this.plants.correct();
});

Given('the source now disagrees with that correction', async function () {
  await this.plants.change(["update $plants set name = 'Warehouse rose' where code = 'P01'"]);
});

Given('the copied Plants table and its source both contain the same two plants', async function () {
  await plants(this);
});

Given('the copied Plants source has a valid changed plant P01 followed by an invalid plant P02', async function () {
  await plants(this);
  await this.plants.invalidCandidates();
});

Given('the copied Plants table contains plant P01 and its source is now empty', async function () {
  await plants(this);
  await this.plants.change(['delete from $plants']);
});

Given('the copied Plants table has an hourly schedule', async function () {
  await plants(this);
  await this.plants.schedule();
});

When('the hourly Plants refresh runs', async function () { await this.plants.run(); });
When('the user removes Plants', async function () { await this.plants.remove(); });

Then('the correction is kept and the disagreement is recorded', async function () {
  assert.equal((await this.plants.api.row('Plants', 'P01')).title, 'Personal rose');
  assert.match(JSON.stringify(await this.plants.conflicts()), /Warehouse rose/);
});

Then('the run is one undoable system-attributed batch', async function () { await this.plants.assertSystemBatch(); });

Then('the execution reports two unchanged rows and no changed rows', async function () {
  assert.equal(this.plants.execution.outcome, 'success');
  assert.match(this.plants.execution.result, /2 unchanged/);
  assert.match(this.plants.execution.result, /0 changed/);
});

Then('the responsible administrators receive a notice naming Plants and its new conflict count', async function () {
  const notices = await acceptanceSql("select subject, body from featherbase.email_queue where subject = 'Copy refresh conflicts: Plants'");
  assert.ok(notices.length > 0);
  assert.ok(notices.some(n => n.body.includes('1 new conflict')));
  assert.ok(notices.every(n => !n.body.includes('Warehouse rose') && !n.body.includes('Personal rose')));
});

Then('the execution fails and Plants still has its previous values', async function () {
  assert.equal(this.plants.execution.outcome, 'error');
  assert.equal((await this.plants.api.row('Plants', 'P01')).title, 'Rose');
  assert.equal((await this.plants.api.row('Plants', 'P02')).title, 'Fern');
});

Then('no batch or conflict from that failed run is retained', async function () {
  assert.equal((await acceptanceSql("select count(*)::int as n from featherbase.import_log where ref_table = 'Plants'"))[0].n, this.plants.before);
  assert.equal((await acceptanceSql("select row_id from featherbase.import_conflict where ref_table = 'Plants'")).length, 0);
});

Then('plant P01 is marked deleted at source in an undoable system-attributed batch', async function () {
  assert.equal((await this.plants.api.row('Plants', 'P01')).deleted_at_source, true);
  await this.plants.assertSystemBatch();
  assert.equal((await this.plants.api.row('Plants', 'P01')).deleted_at_source, false);
});

Then('its schedule and pending refresh are removed', async function () {
  const method = this.plants.job.method;
  assert.equal((await acceptanceSql('select row_id from featherbase.scheduled_job where method = $1', [method])).length, 0);
  assert.equal((await acceptanceSql("select row_id from featherbase.background_job where method = $1 and job_status = 'queued'", [method])).length, 0);
});
