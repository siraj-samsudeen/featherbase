'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { CapturedEmail } = require('../support/pages/captured-email');

Given('the user can read a reference notice with a configured reading presentation', async function () {
  this.capturedEmail = new CapturedEmail(await this.asSystemManager());
  await this.capturedEmail.seedReference();
});
When('the user opens the reference notice', async function () { await this.capturedEmail.openReference(); });
Then('the reference notice uses its configured reading presentation', async function () { await this.capturedEmail.expectReference(); });
Then('the ordinary editable reference form remains available for writable rows', async function () { await this.capturedEmail.expectEditable(); });
