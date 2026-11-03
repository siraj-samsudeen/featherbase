'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');

Given('the user has two disposable local reset instances with different uploads', async function () {
  const { resetFixture } = await import('../../tools/reset-fixture.mjs');
  this.localReset = await resetFixture();
});

When('the user confirms resetting the first local instance', function () {
  this.resetResult = this.localReset.run(['reset', 'acme/shop', '--yes']);
});

Then("only the first instance's database and isolated uploads are removed", async function () {
  assert.equal(this.resetResult.status, 0, this.resetResult.stdout + this.resetResult.stderr);
  await this.localReset.assertRemoved();
});

Then('the other instance and legacy shared uploads remain unchanged', async function () {
  await this.localReset.assertPreserved({ selected: false });
});

Then('the user is told to prepare the instance separately', function () {
  assert.match(this.resetResult.stdout, /Next: featherbase setup/);
  assert.doesNotMatch(this.resetResult.stdout, /Preparing|Migrating|Installing/);
});

When('the user previews resetting the first local instance', function () {
  this.resetResult = this.localReset.run(['reset']);
});

Then("the reset describes the first instance's database and upload count without changing either instance", async function () {
  assert.equal(this.resetResult.status, 1);
  assert.ok(this.resetResult.stdout.includes(this.localReset.names[0]));
  assert.ok(this.resetResult.stdout.includes(this.localReset.stores[0]));
  assert.match(this.resetResult.stdout, /1 file/);
  assert.match(this.resetResult.stderr, /--yes/);
  await this.localReset.assertPreserved();
});

When('the user attempts reset with unsafe target selections', async function () {
  this.unsafeResetResults = await this.localReset.attemptUnsafeSelections();
});

Then('every unsafe reset is refused without changing either instance', async function () {
  for (const result of this.unsafeResetResults) {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Refusing|development only|only uses one on this machine/);
    assert.doesNotMatch(result.stdout + result.stderr, /hidden/);
  }
  await this.localReset.assertPreserved();
});

After(async function () {
  if (this.localReset) await this.localReset.close();
});
