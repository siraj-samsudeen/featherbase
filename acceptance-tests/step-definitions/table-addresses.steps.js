'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { TableAddresses, IDS } = require('../support/pages/table-addresses');

Given('the user manages a Table named Route Probe with a row called Stock review', async function () {
  let editorRole;
  await this.withApi(async api => {
    await TableAddresses.arrange(api);
    await api.readerRoleFor('Route Probe');
    editorRole = await TableAddresses.editorRole(api);
  });
  await this.person('the route editor', [editorRole]);
  this.addresses = new TableAddresses(await this.actor());
});
When('the user opens Route Probe through Table navigation and edits Stock review', async function () {
  this.addresses = new TableAddresses(await this.signedIn('the route editor'));
  await this.addresses.editStock();
});
Then('its address uses the Table segment route-probe', async function () {
  await this.addresses.stockAddress();
});
Then('the saved row belongs to Route Probe with its original labels', async function () {
  await this.withApi(api => this.addresses.originalIdentity(api));
});
Given('the user manages a Table named New Table', async function () {
  await this.withApi(api => TableAddresses.arrange(api, 'New Table'));
  this.addresses = new TableAddresses(await this.actor());
});
When('the user opens New Table through Table navigation', async function () { await this.addresses.navigate('New Table'); });
Then('its list opens separately from the Table builder', async function () { await this.addresses.reservedTable(); });
Given('the user manages a Table named Route Probe with rows identified by columns, merge, new and A \\/ B?x#%', async function () {
  await this.withApi(api => TableAddresses.arrange(api, 'Route Probe', IDS));
  this.addresses = new TableAddresses(await this.actor());
});
When('the user opens each Route Probe row by its shared address', async function () { await this.addresses.reservedRows(); });
Then('each existing row opens with its exact ID instead of a tool or a new-row form', async function () {
  await this.withApi(api => this.addresses.exactRows(api));
});
When('the user follows filtered, new-row, print, portal and map destinations for Route Probe', async function () {
  await this.withApi(api => this.addresses.contextDestinations(api));
});
Then('the destinations retain their selected work and unchanged row identity', async function () {
  await this.withApi(api => this.addresses.stockIdentity(api));
});
Then('the settings destination still opens System Settings by its real name', async function () { await this.addresses.settings(); });
Given('two existing Table definitions have the same normalized spelling', async function () {
  await this.withApi(TableAddresses.ambiguousDefinitions);
  this.addresses = new TableAddresses(await this.actor());
});
When('the user opens that spelling as a Table address', async function () {
  await this.addresses.openAmbiguous();
});
Then('the ambiguity is reported without opening either Table', async function () {
  await this.withApi(api => this.addresses.ambiguity(api));
});
