'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { ScriptReportPage } = require('../support/pages/script-report-page');

async function arrange(world) {
  await world.withApi(api => ScriptReportPage.install(api));
  world.scriptReport = new ScriptReportPage(await world.actor());
}

Given('the Stock Check script report starts with kind "small", quantity zero, enabled false and note "starting note"', async function () {
  await arrange(this);
});

When('the user opens Stock Check', async function () {
  await this.scriptReport.openCheck();
});

Then('its filters and first answer use those starting values', async function () {
  await this.attach(await this.scriptReport.screenshot(), 'image/png');
  await this.attach(JSON.stringify(this.scriptReport.firstCheck, null, 2), 'application/json');
  await this.scriptReport.expectCheckDefaults();
});

Given('the user has opened Stock Check with its starting values', async function () {
  await arrange(this);
  await this.scriptReport.openCheck();
});

When('the user clears the kind and quantity and changes the note to {string}', async function (note) {
  await this.scriptReport.clearConstraints(note);
});

When('the user runs Stock Check again', async function () {
  await this.scriptReport.runAgain();
});

Then('kind and quantity stay empty and no longer constrain the answer', async function () {
  await this.scriptReport.expectUnconstrained();
});

Then('the answer uses note {string} rather than "starting note"', async function (note) {
  await this.scriptReport.expectNote(note);
});

When('the user opens Stock Review which starts with kind "large"', async function () {
  await this.scriptReport.openReview();
});

Then("Stock Review's filters and first answer use its own starting values", async function () {
  await this.scriptReport.expectReviewDefaults();
});
