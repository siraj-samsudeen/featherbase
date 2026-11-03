'use strict';

const { Given, When, Then, After } = require('@cucumber/cucumber');
const { randomUUID } = require('node:crypto');
const { AccessTokens } = require('../support/pages/access-tokens');

Given('the service account {string} exists', async function (name) {
  this.accessTokens = await AccessTokens.arrange();
  await this.accessTokens.createAccount(name);
});

Given('the service accounts {string} and {string} exist', async function (first, second) {
  this.accessTokens = await AccessTokens.arrange();
  await this.accessTokens.createAccount(first);
  await this.accessTokens.createAccount(second);
});

Given('the service account {string} owns one revoked token and one expired token', async function (name) {
  this.accessTokens = await AccessTokens.arrange();
  await this.accessTokens.createAccount(name);
  await this.accessTokens.oldTokens();
});

Given('the user is preparing a token for {string}', async function (name) {
  this.accessTokens = await AccessTokens.arrange();
  await this.accessTokens.createAccount(name);
  await this.accessTokens.open(await this.asSystemManager());
  await this.accessTokens.prepareToken();
});

Given('the service account {string} has a working token named {string}', async function (name, label) {
  this.accessTokens = await AccessTokens.arrange();
  await this.accessTokens.createAccount(name);
  await this.accessTokens.workingToken(label);
});

When('a System Manager edits its name to {string} but cancels', async function (name) {
  await this.accessTokens.open(await this.asSystemManager());
  await this.accessTokens.cancelAccountRename(name);
});
Then('the service account is still named {string}', async function (name) {
  await this.accessTokens.expectAccountNames([name]);
});
When('the user prepares another token for {string}', async function (name) {
  await this.accessTokens.open(await this.asSystemManager());
  await this.accessTokens.prepareToken();
});
Then('its suggested name is {string}', async function (name) { await this.accessTokens.expectPreparedName(name); });
When('the user replaces the suggested name with {string} and changes owner', async function (name) {
  await this.accessTokens.customNameAndChangeOwner(name);
});
Then('the name remains {string}', async function (name) { await this.accessTokens.expectPreparedName(name); });
When('a System Manager tries to rename the token to a blank name', async function () {
  await this.accessTokens.renameTokenToBlank();
});
Then('the rename is refused and the token is still named {string}', async function (name) {
  await this.accessTokens.expectRefusedTokenName(name);
});
When('a System Manager renames it to {string} and the token to {string}', async function (account, token) {
  await this.accessTokens.renameAccountAndToken(account, token);
});
Then('the same credential authenticates as the same account named {string}', async function (name) {
  await this.accessTokens.expectSameCredential(name);
});
Then('the token is listed as {string} without its secret', async function (name) {
  await this.accessTokens.expectListedToken(name);
});
When('an ordinary user tries to rename that token to {string}', async function (name) {
  const email = `acceptance-${randomUUID()}@example.com`;
  const password = randomUUID();
  await this.withApi(api => api.createPerson(email, password, []));
  await this.accessTokens.renameAsOrdinaryUser({ email, password }, name);
});
When('a System Manager renames {string} to {string}', async function (from, to) {
  await this.accessTokens.claimTakenName(from, to);
});
Then('the rename is refused and both accounts keep their names', async function () {
  await this.accessTokens.expectBothNames();
});

After(async function () { await this.accessTokens?.cleanUp(); });
