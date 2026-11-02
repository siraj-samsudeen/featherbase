'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { BaseCli } = require('../support/pages/base-cli');

Given('the user has installed the checkout dependencies but has not configured a database', function () {
  this.baseCli = new BaseCli();
  this.baseCli.openWithoutDatabase();
});

Given('the user has installed the checkout dependencies', function () {
  this.baseCli = new BaseCli();
  this.baseCli.openWithoutDatabase();
});

When('the user opens Featherbase command-line help', function () { this.baseCli.runHelp(); });
When('the user enters an unknown Featherbase command', function () { this.baseCli.mistypeCommand(); });

Then('the user sees how to prepare an instance, start it and check its health', function () {
  for (const action of ['setup', 'start', 'health']) assert.ok(this.baseCli.output().includes(`featherbase ${action}`));
});

Then('each action explains what it does and what to run next', function () {
  assert.ok(this.baseCli.output().includes('Prepare the platform database'));
  assert.ok(this.baseCli.output().includes('Start the API and web app'));
  assert.ok(this.baseCli.output().includes('Report readiness'));
  assert.ok(this.baseCli.output().includes('Next:'));
});

Then('help does not require a database connection', function () {
  assert.equal(this.baseCli.exitCode(), 0, this.baseCli.error());
});

Then('the command fails and points to the relevant help', function () {
  assert.equal(this.baseCli.exitCode(), 1);
  assert.ok(this.baseCli.error().includes('Run featherbase --help'));
});

Then('no setup or installation is performed', function () {
  assert.equal(this.baseCli.output(), '');
});
