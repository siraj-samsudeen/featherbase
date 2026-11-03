'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { importedZones, zonesCsv } = require('../support/fixtures/reimport-zones');
const { ImportWizardPage } = require('../support/pages/import-wizard-page');

Given('the user has imported 61 zones with their populations', async function () {
  await importedZones(this);
});

Given("the user has imported 61 zones and corrected the first zone's region from North to South", async function () {
  await importedZones(this, { corrected: true });
});

Given("the user has imported 61 zones without change history and corrected the first zone's region", async function () {
  await importedZones(this, { corrected: true, history: false });
});

async function prepare(world, { population = false, region = false, check = false } = {}) {
  const rows = world.reimport.rows.map(r => ({ ...r }));
  if (population) rows[0].population += 7;
  if (region) rows[0].region = 'East';
  const wizard = new ImportWizardPage(await world.actor());
  await wizard.openForTable(world.reimport.table);
  await wizard.dropCsv('zones.csv', zonesCsv(rows));
  await wizard.matchOn('zone_code');
  if (check) await wizard.check();
  world.reimport.wizard = wizard;
  world.reimport.checked = check;
}

When('the user chooses zone codes to match the identical zones file before requesting a check', async function () {
  await prepare(this);
});
When('the user checks the zones file with one changed population matched on its zone codes', async function () {
  await prepare(this, { population: true, check: true });
});
When('the user checks a zones file matched on zone codes with a new East region and a changed population for that zone', async function () {
  await prepare(this, { population: true, region: true, check: true });
});
When('the user checks the original zones file matched on its zone codes', async function () {
  await prepare(this, { check: true });
});

async function reports(world, phrases) {
  const text = await world.reimport.wizard.previewText(world.reimport.checked);
  for (const phrase of phrases) {
    const at = text.indexOf(phrase);
    // A count of 61 must never satisfy an assertion for 1.
    const exactCount = at >= 0 && (at === 0 || Number.isNaN(Number.parseInt(text[at - 1], 10)));
    assert.ok(exactCount, `Expected "${phrase}" in preview; received: ${text}`);
  }
}

Then('the preview reports 0 changed rows, 61 unchanged rows and 0 added rows', async function () {
  await reports(this, ['0 rows change', '61 unchanged', '0 added']);
});
Then('the preview reports 1 changed row, 60 unchanged rows and 0 added rows', async function () {
  await reports(this, ['1 row changes', '60 unchanged', '0 added']);
});
Then('the preview reports 0 changed values and explains matching rather than appending', async function () {
  await reports(this, ['0 values change']);
  assert.equal(await this.reimport.wizard.explainsMatchingOn('Zone Code'), true, 'Explain matching on Zone Code, not appending');
});
Then('the preview reports 1 changed value', async function () {
  await reports(this, ['1 value changes']);
});
Then("the preview reports 1 changed row and 1 row keeping the user's correction", async function () {
  await reports(this, ['1 row changes', '1 row keeps your corrections']);
});
Then('it reports 1 changed value, 1 retained value and 1 new conflict', async function () {
  await reports(this, ['1 value changes', '1 value retained', '1 new conflict']);
});
Then("the preview reports 0 changed rows, 61 unchanged rows and 1 row keeping the user's correction", async function () {
  await reports(this, ['0 rows change', '61 unchanged', '1 row keeps your corrections']);
});
Then('it reports 1 retained value and 0 new conflicts', async function () {
  await reports(this, ['1 value retained', '0 new conflicts']);
});
Then('the preview reports the differing region as a change rather than a retained correction', async function () {
  await reports(this, ['1 row changes', '60 unchanged', '1 value changes', '0 rows keep your corrections']);
});
Then('the user is warned that imports overwrite existing values without change history', async function () {
  await reports(this, ['does not keep change history', 'Imports overwrite existing values']);
});
