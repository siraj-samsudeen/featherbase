'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { NavigationHistory } = require('../support/pages/navigation-history');

async function history(world) {
  if (!world.history) {
    await world.person('the user', ['System Manager']);
    world.history = new NavigationHistory(await world.actor());
    await world.history.open();
  }
  return world.history;
}

Given('the user has remembered visits to the Person destination', async function () {
  await (await history(this)).remember();
});
Given("the instance has forgotten the user's visits", async function () { await this.history.forget(); });
Given('the browser remembers an old destination absent from the instance history', async function () {
  await (await history(this)).remember('Old destination');
});
Given("the instance remembers the user's Person destination", async function () { await this.history.savePersonVisit(); });
When('the user reloads the app', async function () { await this.history.reload(); });
Then("the user's navigation history has no Person destination", async function () { await this.history.expectDestination('Person', false); });
Then("the user's navigation history contains Person but not the old destination", async function () {
  await this.history.expectDestination('Person', true);
  await this.history.expectDestination('Old destination', false);
});
Given("the user's history is loading", async function () { await (await history(this)).holdSummary(); });
When('the user opens the Person destination before history finishes loading', async function () { await this.history.visitPerson(); });
Then("the Person destination remains in the user's navigation history", async function () { await this.history.expectDestination('Person', true); });
When("the user's history is still loading", async function () { await this.history.holdSummary(); });
Then('neither navigation surface offers the old destination', async function () {
  try { await this.history.expectDestination('Old destination', false); }
  finally { this.history.release(); }
});
When('the initial history request fails', async function () { await this.history.failSummary(); });
Then('both navigation surfaces offer the Person destination', async function () { await this.history.expectDestination('Person', true); });
