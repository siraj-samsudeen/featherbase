'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { LinkedGoogle } = require('../support/pages/linked-google');

Given('a person was invited by a Google address and has signed in with it', async function () {
  this.linkedGoogle = await this.withApi(LinkedGoogle.invitedPerson);
  const { page } = await this.newPage('the-person', 'the person');
  await LinkedGoogle.signInWithGoogle(page, this.linkedGoogle.address);
});
When("a System Manager opens the person's sign-in methods", async function () {
  this.googleRow = new LinkedGoogle(await this.asSystemManager());
  await this.googleRow.open(this.linkedGoogle.person);
});
Then("the Google sign-in leads with the person's address", async function () {
  await this.googleRow.leadsWith(this.linkedGoogle.address);
});
Then('it says it was linked at first sign-in, and when it was last used', async function () {
  await this.googleRow.linkedAtFirstSignIn();
});
Then("Google's account number shows only under the sign-in's details", async function () {
  await this.googleRow.accountNumberOnlyInDetails();
});
