'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { PrototypeLibrary } = require('../support/pages/prototype-library');

async function library(world) {
  world.prototype = new PrototypeLibrary(await world.asSystemManager());
  await world.prototype.open();
}

Given('the user is exploring the native prototype library', async function () { await library(this); });
When('the user searches the examples for {string}', async function (query) { await this.prototype.searchExamples(query); });
Then('the user sees matching working examples and their reuse locations', async function () { await this.prototype.expectMatchingExamples(); });
Then('unrelated examples are excluded', async function () { await this.prototype.expectUnrelatedExcluded(); });
Given('the user has searched the prototype collection for {string}', async function (query) { await library(this); await this.prototype.searchCollection(query); });
When('the user opens an item and follows its related collection', async function () { await this.prototype.followRelated(); });
Then('the user can follow the trail back to the original collection', async function () { await this.prototype.returnAlongTrail(); });
Then('the original search and selected section are retained', async function () { await this.prototype.expectSearchRetained(); });
Given('the user is exploring the populated synthetic prototype', async function () { await library(this); });
When('the user edits an example and resets the prototype', async function () { await this.prototype.editAndReset(); });
Then('the original synthetic example is restored', async function () { await this.prototype.expectReset(); });
Then('the preview states that access restrictions are simulated', async function () { await this.prototype.expectSimulationLabel(); });
Given('the user is exploring the synthetic prototype', async function () { await library(this); });
When('an action has no synthetic response', async function () { await this.prototype.unsupportedAction(); });
Then('the action is refused without contacting a real account', async function () { await this.prototype.expectRefused(); });
Then('the user is not told that the action succeeded', function () { if (this.prototype.refusal.ok()) throw new Error('Unsupported action succeeded'); });
Given('the user has explored a row form in the synthetic prototype', async function () { await library(this); await this.prototype.rowForm(); await this.prototype.captureForm(); });
When('the same screen is connected to an isolated real server', async function () { await this.withApi(PrototypeLibrary.prepareReal); await this.prototype.connectReal(); });
Then('the row form retains its controls and layout', async function () { await this.prototype.expectRetained(); });
Then('a saved change is still visible after reloading', async function () { await this.prototype.expectPersistentSave(); });
