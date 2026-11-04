'use strict';

const { Given, When, Then, After } = require('@cucumber/cucumber');
const { Api, signedInState } = require('../support/api');
const { TableStoragePage } = require('../support/pages/table-storage-page');

async function journey(world) {
  world.storage860 ??= new TableStoragePage(await world.asSystemManager(), await Api.asSystemManager());
  return world.storage860;
}
After(async function () { await this.storage860?.cleanup(); });

Given('the user has a Table called "SAP Plant" in the "Custom" module', async function () { await (await journey(this)).define(); });
Given('its effective authored display name is "Plant catalogue"', async function () { await this.storage860.authorTitle(); });
Given('"SAP Plant" is a Settings Table in the "Custom" module', async function () { await (await journey(this)).define('settings'); });
Given('"SAP Plant" is connected to an outside Data Source in the "Custom" module', async function () { await (await journey(this)).connect(); });
Given('an installed app owns "SAP Plant" with explicitly mapped storage', async function () { await (await journey(this)).install(); });
Given('Featherbase has no configured warehouse mapping for "SAP Plant"', function () {});
Given('the user can read the definition of "SAP Plant" but not its metadata', async function () {
  const flow = await journey(this);
  await flow.define();
  const role = await flow.api.readerRoleFor('Table');
  await flow.api.createPerson('storage-860-reader@example.com', 'storage-860-reader-password', [role]);
  const { page } = await this.newPage('storage-reader', 'Definition reader', await signedInState('storage-860-reader@example.com', 'storage-860-reader-password'));
  flow.page = page;
});
When('the user opens the settings for "SAP Plant"', async function () { await this.storage860.open(); });
When("the user opens the settings for the app's \"SAP Plant\"", async function () { await this.storage860.open(); });
Then('the settings identify "SAP Plant" rather than "Custom"', async function () { await this.storage860.title('SAP Plant'); });
Then('the settings identify "Plant catalogue"', async function () { await this.storage860.title('Plant catalogue'); });
Then('the user can copy schema "featherbase", relation "sap_plant" and row key "row_id" without editing them', async function () { await this.storage860.copy(['featherbase', 'sap_plant', 'row_id']); });
Then("the user can copy the app's mapped storage identity rather than a name inferred from its label", async function () { await this.storage860.copy(['tasker', 'task', 'row_id']); });
Then('the user can copy shared storage "featherbase.single_value" with key "table_name, field" and discriminator "SAP Plant"', async function () { await this.storage860.copy(['featherbase', 'single_value', 'table_name, field', 'SAP Plant']); });
Then('its storage identity describes its source binding without credentials', async function () { await this.storage860.copy(['storage-860-source', 'erp', 'plants_actual', 'plant_code']); });
Then('its storage identity is not disclosed and the definition form remains usable', async function () { await this.storage860.denied(); });
Then('no warehouse destination is shown', async function () { await this.storage860.absentWarehouse(); });
