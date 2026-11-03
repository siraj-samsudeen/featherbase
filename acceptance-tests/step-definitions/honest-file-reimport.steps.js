'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { importedZones, zonesCsv, zoneCount, analyzeRestrictedKeys, populations } = require('../support/fixtures/reimport-zones');
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

async function prepare(world, { population = false, region = false, check = false, match = true, changed = [], unmap = false } = {}) {
  const rows = world.reimport.rows.map(r => ({ ...r }));
  if (population) rows[0].population += 7;
  for (const index of changed) rows[index].population += 7;
  if (region) rows[0].region = 'East';
  const wizard = new ImportWizardPage(await world.actor());
  await wizard.openForTable(world.reimport.table);
  await wizard.dropCsv('zones.csv', zonesCsv(rows));
  await wizard.settleChoices();
  if (unmap) await wizard.unmapFirstColumn();
  if (match) await wizard.matchOn('zone_code');
  if (check) await wizard.check();
  world.reimport.wizard = wizard;
  world.reimport.checked = check;
  world.reimport.incoming = rows;
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

Given('the user has imported 61 zones matched on their zone codes', async function () {
  await importedZones(this, { keyed: true });
});
Given('the user has imported 61 zones without choosing a matching column', async function () {
  await importedZones(this);
});
Given('the user has imported zones with repeated zone codes', async function () {
  await importedZones(this, { repeated: true });
});
Given('the user can read the zones but cannot read their zone codes', async function () {
  await importedZones(this, { restricted: true });
});
Given('the user has imported 520 zones with their populations', async function () {
  await importedZones(this, { count: 520 });
});

When('the user prepares the zones file for another import', async function () {
  await prepare(this, { match: false });
});
When('the user prepares the identical zones file for another import', async function () {
  if (this.reimport.restricted) this.reimport.analysis = await analyzeRestrictedKeys(this);
  else await prepare(this, { match: false });
});
When('the user prepares another zones file without mapping its zone codes', async function () {
  await prepare(this, { match: false, unmap: true });
});

Then('zone codes are offered as the remembered matching column', async function () {
  const text = await this.reimport.wizard.suggestionText();
  assert.ok(text.includes('as last time') || text.includes('remembered'), `No remembered-key explanation: ${text}`);
  assert.equal(await this.reimport.wizard.activeKey(), '', 'Remembered key must not activate itself');
  assert.equal(await this.reimport.wizard.offersMatchingOn('Zone Code'), true, 'Offer an explicit Match on Zone Code action');
});
Then('zone codes are offered because each incoming code matches exactly one readable zone', async function () {
  assert.equal(await this.reimport.wizard.offersMatchingOn('Zone Code'), true, 'Missing value-derived Match on Zone Code suggestion');
});
Then('no matching column is active until the user accepts or chooses one', async function () {
  assert.equal(await this.reimport.wizard.activeKey(), '');
  await this.reimport.wizard.acceptMatchingOn('Zone Code');
  assert.equal(await this.reimport.wizard.activeKey(), 'zone_code');
});
Then('the repeated zone codes are not offered as a one-to-one matching column', async function () {
  assert.equal(await this.reimport.wizard.offersMatchingOn('Zone Code'), false);
  assert.equal(await this.reimport.wizard.activeKey(), '');
});
Then('zone codes are not offered as a matching column or used to disclose overlap', async function () {
  assert.deepEqual(this.reimport.analysis, { key_candidates: [] });
});
Then('zone codes are not offered as a remembered matching column', async function () {
  assert.equal(await this.reimport.wizard.offersMatchingOn('Zone Code'), false);
  assert.equal((await this.reimport.wizard.keyChoices()).includes('zone_code'), false);
  assert.equal(await this.reimport.wizard.activeKey(), '');
});

When('the user imports the identical zones file without choosing a matching column', async function () {
  await prepare(this, { match: false });
  await this.reimport.wizard.attemptImport();
});
Then('the import waits for acknowledgement that 61 more rows will be added', async function () {
  assert.equal(await zoneCount(this), 61, 'Appending must not write before acknowledgement');
  assert.ok((await this.reimport.wizard.appendWarningText()).includes('61 more rows'), 'Explain that appending adds 61 more rows');
  assert.equal(await this.reimport.wizard.completed(), false);
});
Then('the user can choose the suggested zone codes instead', async function () {
  await this.reimport.wizard.acceptMatchingOn('Zone Code');
  assert.equal(await this.reimport.wizard.activeKey(), 'zone_code');
  assert.equal(await this.reimport.wizard.appendWarningText(), '', 'Choosing a key clears the append warning');
  assert.equal(await zoneCount(this), 61);
});
Given('the user has been warned that appending the identical zones file adds 61 more rows', async function () {
  await prepare(this, { match: false });
  await this.reimport.wizard.attemptImport();
  assert.ok((await this.reimport.wizard.appendWarningText()).includes('61 more rows'), 'Missing full-overlap warning before append');
  assert.equal(await zoneCount(this), 61);
});
When('the user explicitly acknowledges the append', async function () {
  await this.reimport.wizard.acknowledgeAppend();
});
Then('the zones contain 122 rows', async function () {
  assert.equal(await zoneCount(this), 122);
});

When('the user imports the identical zones file matched on its zone codes', async function () {
  await prepare(this);
  await this.reimport.wizard.attemptImport();
});
When('the user imports the zones file with {int} changed populations matched on its zone codes', async function (count) {
  await prepare(this, { changed: Array.from({ length: count }, (_, i) => i) });
  await this.reimport.wizard.attemptImport();
});
When('the user imports the zones file with 11 changed populations among its first 500 zones and 10 among its last 20 matched on zone codes', async function () {
  await prepare(this, { changed: [...Array.from({ length: 11 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 500 + i)] });
  await this.reimport.wizard.attemptImport();
});
Then('the import proceeds without a typed change count', async function () {
  assert.equal(await this.reimport.wizard.confirmationText(), '', 'Unchanged matches must not count toward the typed-confirmation threshold');
  assert.equal(await this.reimport.wizard.completed(), true);
  assert.equal(await zoneCount(this), 61);
  assert.deepEqual(await populations(this), Object.fromEntries(this.reimport.incoming.map(row => [row.zone_code, row.population])));
});
Then('the import waits for the user to type 21', async function () {
  const text = await this.reimport.wizard.confirmationText();
  assert.ok(text.includes('Type 21 to confirm'), `Expected changed-only count 21, received: ${text}`);
  assert.equal(await this.reimport.wizard.completed(), false);
  assert.equal(await zoneCount(this), this.reimport.rows.length);
  assert.deepEqual(await populations(this), Object.fromEntries(this.reimport.rows.map(row => [row.zone_code, row.population])));
});
Then('a missing or wrong count leaves the import blocked', async function () {
  assert.equal(await this.reimport.wizard.missingAndWrongCountsBlock(), true);
  assert.equal(await zoneCount(this), 61);
  assert.deepEqual(await populations(this), Object.fromEntries(this.reimport.rows.map(row => [row.zone_code, row.population])));
});

Then('import history records 61 processed matches rather than 61 value changes', async function () {
  const text = await this.reimport.wizard.latestHistoryText(this.reimport.table);
  assert.ok(text.includes('61 matched') || text.includes('61 processed'), `Historical counts must be labelled matched/processed: ${text}`);
  assert.equal(text.includes('61 changed'), false);
});
Then('undoing that import reports that the 61 matched rows had no values changed', async function () {
  const text = await this.reimport.wizard.unchangedUndoText();
  assert.ok(text.includes('restore 0') && text.includes('delete 0'), `No values should need restoring: ${text}`);
  assert.equal(text.split('no changes to undo').length - 1, 61, 'All 61 matches must be classified unchanged by undo');
  assert.equal(await zoneCount(this), 61);
});
