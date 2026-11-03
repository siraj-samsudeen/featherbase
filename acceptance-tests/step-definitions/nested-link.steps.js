'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { NestedLink } = require('../support/pages/nested-link');

Given('the user is adding a role to a person', async function () {
  const person = await this.withApi(NestedLink.newPerson);
  this.nestedLink = new NestedLink(await this.asSystemManager());
  await this.nestedLink.addRole(person);
});
When('the user types {string} into the new role and picks {string}', async function (text, name) {
  await this.nestedLink.type(text);
  await this.nestedLink.pick(name);
});
Then('only roles matching {string} were offered', function (fragment) { this.nestedLink.expectOfferedOnly(fragment); });
Then('after saving, the person has the System Manager role', async function () {
  await this.nestedLink.expectSaved();
  assert.deepEqual(await this.withApi((api) => NestedLink.rolesOf(api, this.nestedLink.person)), ['System Manager']);
});
When('the user types {string} into the new role without picking one', async function (text) {
  await this.nestedLink.type(text);
  await this.nestedLink.leave();
});
Then('the person cannot be saved until the role is picked', async function () { await this.nestedLink.expectRefused(); });
Then('the person has no Store Boss role', async function () {
  assert.deepEqual(await this.withApi((api) => NestedLink.rolesOf(api, this.nestedLink.person)), []);
});
