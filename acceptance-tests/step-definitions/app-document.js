'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { AppDocument } = require('../support/pages/app-document');

Given('the user is using Tasker', async function () {
  await this.withApi(AppDocument.install);
  this.document = new AppDocument(await this.asSystemManager());
  await this.document.tasker();
});
When("a piece of Tasker's content cannot load", async function () { await this.document.missingPiece(); });
Then('that piece is shown as missing', async function () { await this.document.expectMissing(); });
Then("neither Tasker's home nor Featherbase replaces it", async function () { await this.document.expectNotReplaced(); });
Given('the user is signed out', async function () {
  const { page } = await this.newPage('signed-out', 'Signed out');
  this.document = new AppDocument(page);
});
When('the user opens a nested Tasker address with a selected task and signs in', async function () {
  await this.withApi(api => this.document.signInAtTask(api));
});
Then('the same address and selected task survive refreshing the page', async function () { await this.document.expectReturn(); });
Given("Featherbase has been built without Tasker's client files", async function () { await AppDocument.builtCore(); });
When('built Tasker is installed', { timeout: 300_000 }, async function () { await AppDocument.deliveredApp(); this.delivered = true; });
Then('Tasker opens with the shared navigation without rebuilding Featherbase or adding an app-specific platform route', function () {
  if (!this.delivered) throw new Error('The built-artifact delivery proof did not finish');
});
