'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { AppNavigation } = require('../support/pages/app-navigation');

Given('the user can open Featherbase, Tasker and Feather Dash', async function () {
  await this.withApi(AppNavigation.install);
  this.navigation = new AppNavigation(await this.asSystemManager());
});
Given('the user can open Tasker and Feather Dash but cannot open Featherbase', async function () {
  await this.withApi(AppNavigation.install);
  await this.person('the user', ['Feather Dash Reader']);
  this.navigation = new AppNavigation(await this.actor());
});
When("the user chooses Featherbase from Tasker's application name", async function () { await this.navigation.chooseBase(); });
Then('Featherbase opens', async function () { await this.navigation.expectBase(); });
Then('no separate administration control is offered on Tasker', async function () { await this.navigation.expectNoSeparateAdmin(); });
When('the user opens the application choices in Feather Dash', async function () { await this.navigation.dash(); });
Then('Tasker and Feather Dash are offered', async function () { await this.navigation.expectAppsOnly(); });
Then('Featherbase is not offered', async function () { await this.navigation.expectNoBase(); });
Given('Tasker has a project named September stock review with two tasks', async function () { await this.withApi(AppNavigation.project); });
When('the user opens September stock review through the shared navigation', async function () { await this.navigation.openProject(); });
Then("the project's two tasks are shown", async function () { await this.navigation.expectTasks(); });
Then('the shared navigation identifies September stock review as current', async function () { await this.navigation.expectProjectCurrent(); });
Given('the user has selected Lakeside in Feather Dash', async function () {
  await this.withApi(api => AppNavigation.store(api, this.people.get('the user').email));
  await this.navigation.selectStore();
});
When('the user opens the report through the shared navigation', async function () { await this.navigation.openReport(); });
Then('Lakeside remains selected', async function () { await this.navigation.expectStore(); });
Then('Feather Dash shows the report state for Lakeside', async function () { await this.navigation.expectReport(); });
