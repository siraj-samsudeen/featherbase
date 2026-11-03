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
