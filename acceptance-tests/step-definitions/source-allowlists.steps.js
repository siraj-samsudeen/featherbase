'use strict';

const { After, Given, When, Then } = require('@cucumber/cucumber');
const { SourceAllowlists } = require('../support/source-allowlists');

Given('the user manages a {string} source with default namespace {string}', async function (engine, namespace) {
  await this.withApi(async api => {
    this.sourceAllowlists = new SourceAllowlists(api, engine, namespace);
    await this.sourceAllowlists.prepare();
  });
});

Given('a Postgres source is registered with restriction {string}', async function (entry) {
  await this.withApi(async api => {
    this.sourceAllowlists = new SourceAllowlists(api, 'postgres', 'public');
    await this.sourceAllowlists.register(entry);
  });
});

When('the user saves its table restriction as {string}', async function (entry) {
  await this.sourceAllowlists.saveRestriction(entry);
});

When('the user changes its restriction to {string}', async function (entry) {
  await this.sourceAllowlists.saveRestriction(entry);
});

Then('saving is refused with restriction-field guidance to use {string}', function (format) {
  this.sourceAllowlists.expectRefused(format);
});

Then('the source is not registered', async function () {
  await this.sourceAllowlists.expectNotRegistered();
});

Then('the source is registered with exactly that restriction', async function () {
  await this.sourceAllowlists.expectRegistered();
});

Then('its stored restriction is still {string}', async function (entry) {
  await this.sourceAllowlists.expectStored(entry);
});

After(async function () {
  await this.sourceAllowlists?.dispose();
});
