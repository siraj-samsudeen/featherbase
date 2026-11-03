'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { CommandBar } = require('../support/pages/command-bar');

Given('the user is viewing the Sign In Method list', async function () {
  this.commandBar = new CommandBar(await this.asSystemManager());
  await this.commandBar.visitSignInMethods();
});

When('the user selects the Sign In Method destination from the command bar', async function () {
  await this.commandBar.searchSignInMethods();
});

Then('the Sign In Method list is shown without the command dropdown', async function () {
  await this.commandBar.expectUnobstructedList();
});

Then('the command bar can be reopened with its history intact', async function () {
  await this.commandBar.expectHistoryOnReopen();
});

Given('the user has searched for Sign In Method', async function () {
  this.commandBar = new CommandBar(await this.asSystemManager());
  await this.commandBar.visitSignInMethods();
  await this.commandBar.searchSignInMethods();
  await this.commandBar.expectSignInMethods();
});

When('the user replays that past search from the command bar', async function () {
  await this.commandBar.replaySignInMethodSearch();
});

Then('the search remains available to edit and run', async function () {
  await this.commandBar.expectEditableSearchAndRun();
});

Given('the user is searching for Person in the command bar', async function () {
  this.commandBar = new CommandBar(await this.asSystemManager());
  await this.commandBar.searchPerson();
});

When('the user chooses the new Person row result using the arrow keys and Enter', async function () {
  await this.commandBar.choosePersonResult('new');
});

Then('a blank Person form is shown without the command dropdown', async function () {
  await this.commandBar.expectPersonForm('new');
});

When('the user chooses the Person definition record using the arrow keys and Enter', async function () {
  await this.commandBar.choosePersonResult('record');
});

Then('the Person definition form is shown without the command dropdown', async function () {
  await this.commandBar.expectPersonForm('record');
});

When('the user replaces the search with Sign In Meth and immediately activates the search', async function () {
  await this.commandBar.replacePersonSearch();
});

Then('the previous Person record is not opened', async function () {
  await this.commandBar.expectReplacementSearch();
});

Given('the user manages the instance', async function () {
  this.commandBar = new CommandBar(await this.asSystemManager());
  await this.commandBar.visitAdmin();
});

Given('the user can read Person but cannot manage the instance', async function () {
  const role = await this.withApi(api => api.readerRoleFor('Person'));
  await this.person('the user', [role]);
  this.commandBar = new CommandBar(await this.actor());
  await this.commandBar.visitAdmin();
});

When('the user finds Instance health through the command bar', async function () {
  await this.commandBar.findDestination('Instance health');
});

Then('the instance health page is shown without the command dropdown', async function () {
  await this.commandBar.expectInstanceHealth();
});

When('the user finds System Settings through the command bar', async function () {
  await this.commandBar.findDestination('System Settings');
});

Then('the existing System Settings form is shown', async function () {
  await this.commandBar.expectExistingSettings();
});

When('the user searches for Instance health through the command bar', async function () {
  await this.commandBar.searchDestination('Instance health');
});

Then('Instance health is not offered', async function () {
  await this.commandBar.expectDestinationAbsent('Instance health');
});

Given('the user is searching for access in the command bar', async function () {
  this.commandBar = new CommandBar(await this.asSystemManager());
  await this.commandBar.searchAccess();
});

When('the user clicks outside the command bar', async function () {
  await this.commandBar.clickOutside();
});

When('the user focuses a result and presses Escape', async function () {
  await this.commandBar.escapeFromResult();
});

When('the user presses Escape in the search', async function () {
  await this.commandBar.escapeFromSearch();
});

Then('its results are hidden with the search preserved', async function () {
  await this.commandBar.expectPreservedDismissal();
});

Then('focusing the command bar shows its results again', async function () {
  await this.commandBar.reopenPreservedSearch();
});

Then('the command shortcut shows its results again', async function () {
  await this.commandBar.reopenPreservedSearch(true);
});
