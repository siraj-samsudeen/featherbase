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
