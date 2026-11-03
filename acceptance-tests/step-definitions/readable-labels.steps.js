'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { Api, signedInState } = require('../support/api');
const { ReadableLabelsPage, UNMAPPED } = require('../support/pages/readable-labels-page');

After(async function () { await this.readable?.cleanup(); });

async function journey(world) {
  world.readable ??= new ReadableLabelsPage(await world.asSystemManager(), await Api.asSystemManager());
  return world.readable;
}

Given('the user defines a contact list with an unlabelled client identifier and an authored service label', async function () {
  await (await journey(this)).defineLabels();
});
When('the user opens the contact list', async function () { await this.readable.openList(); });
Then('the generated identifier label is readable with its acronym preserved', async function () {
  assert.equal((await this.readable.labels())[0], 'Client ID');
});
Then('the authored service label is unchanged', async function () {
  assert.equal((await this.readable.labels())[1], 'myService URL — keep this sentence');
});
Given('the user has customized and translated labels beside unchanged platform defaults', async function () {
  await (await journey(this)).arrangeUpgrade();
});
When('the platform label update is applied', async function () { await this.readable.applyUpgrade(); });
Then('eligible unchanged platform defaults become readable without displacing installed translations', async function () {
  await this.readable.upgradedDefault();
});
Then("the user's custom wording and effective translations remain unchanged", async function () {
  await this.readable.preservedWording();
});
Given('the user has a contact list with authored wording for a technical policy choice', async function () {
  await (await journey(this)).definePolicy();
});
When('the user chooses that policy and saves a contact', async function () { await this.readable.chooseAndSave(); });
Then('the contact shows the authored policy wording in its form, list and filter control', async function () {
  await this.readable.assertPolicySurfaces();
});
Then('filtering by that policy finds the contact using its original value', async function () {
  await this.readable.filterSavedPolicy();
});
Given('the user has a contact list with an unmapped choice containing underscores and no translation', async function () {
  await (await journey(this)).definePolicy({ unmapped: true });
});
When('the user opens that choice in a contact', async function () { await this.readable.openPolicy(); });
Then('the choice text is shown verbatim', async function () { assert.equal(await this.readable.optionText(), UNMAPPED); });
Given("the user's contact policy has different translations for its original value and its authored wording", async function () {
  await (await journey(this)).definePolicy({ translated: true });
  const state = await signedInState('labels-826@example.com', 'acceptance-labels-826');
  const { page } = await this.newPage('translated-reader', 'French contact reader', state);
  this.readable = new ReadableLabelsPage(page, await Api.asSystemManager());
  this.readable.raw = 'create_if_email_domain_allowed';
});
When('the user opens that policy in a contact', async function () { await this.readable.openPolicy(); });
Then('the existing translation of the original value is shown unchanged', async function () {
  assert.equal(await this.readable.optionText(), 'Créer SI permis — iD');
});
