'use strict';

const { Given, When, Then } = require('@cucumber/cucumber');
const { CapturedEmail } = require('../support/pages/captured-email');

for (const [suffix, variant] of [
  ['', 'normal'],
  [' without a message or attachments', 'empty'],
  [' containing unsafe markup and a long line', 'unsafe'],
]) Given(`the user can read the locally captured invoice notice${suffix}`, async function () {
  this.capturedEmail = new CapturedEmail(await this.asSystemManager());
  await this.capturedEmail.seed(variant);
});

When('the user opens the captured invoice notice', async function () { await this.capturedEmail.open(); });
Then('the user reads the invoice notice as an email with its attachment names', async function () { await this.capturedEmail.expectEmail(); });
Then('the user is told that local capture does not confirm external delivery', async function () { await this.capturedEmail.expectNotice(); });
Then('raw values are initially collapsed and cannot be edited', async function () { await this.capturedEmail.expectRaw(); });
Then('the user sees that there is no message body and no attachments', async function () { await this.capturedEmail.expectEmpty(); });
Then('the markup remains visible text without executable content or remote requests', async function () { await this.capturedEmail.expectInert(); });
Then('the message preserves line breaks and fits its reading area', async function () { await this.capturedEmail.expectWrapped(); });

Given('the user can read a reference notice with a configured reading presentation', async function () {
  this.capturedEmail = new CapturedEmail(await this.asSystemManager());
  await this.capturedEmail.seedReference();
});
When('the user opens the reference notice', async function () { await this.capturedEmail.openReference(); });
Then('the reference notice uses its configured reading presentation', async function () { await this.capturedEmail.expectReference(); });
Then('the ordinary editable reference form remains available for writable rows', async function () { await this.capturedEmail.expectEditable(); });
