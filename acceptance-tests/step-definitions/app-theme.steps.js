'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { AppTheme } = require('../support/pages/app-theme');

async function bareReader(world) {
  await world.withApi(AppTheme.install);
  await world.person('the user', ['Bar Reader']);
  world.appTheme = new AppTheme(await world.signedIn('the user'));
  return world.appTheme;
}

Given('the user has chosen the light theme on a device set to dark', async function () {
  const app = await bareReader(this);
  await app.deviceIs('dark');
  await app.choose('light');
});
When("the user opens an app's page that follows the theme", async function () { await this.appTheme.open(); });
Then("the app's page is light", async function () { await this.appTheme.expectApp('light'); });

Given("the user is on an app's page that follows the theme, in the light theme", async function () {
  const app = await bareReader(this);
  await app.deviceIs('light');
  await app.choose('light');
  await app.open();
  await app.expectApp('light');
  await app.markDocument();
});
When('the user switches to the dark theme in the shared bar', async function () { await this.appTheme.switchInBar('dark'); });
Then("the app's page turns dark without reloading", async function () {
  await this.appTheme.expectApp('dark');
  await this.appTheme.expectSameDocument();
});
