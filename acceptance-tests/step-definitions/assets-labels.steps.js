'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { assets } = require('./assets-shared.steps');

const tagNumber = tag => Number(tag.replace('JRA-', ''));

Given('roll R-03 holds tags JRA-000301 to JRA-000400', async function () {
  await assets(this).findOrMake('equipment.tag_roll', 'roll_name', 'R-03', { roll_name: 'R-03', first_no: 301, last_no: 400 });
});

When('the user prints labels from JRA-000301 to JRA-000306', async function () {
  const flow = assets(this);
  const page = await flow.page('the user');
  await flow.pageText('the user', 'labels');
  await page.getByRole('textbox', { name: 'Print from' }).fill('JRA-000301');
  await page.getByRole('textbox', { name: 'Print to' }).fill('JRA-000306');
  const sheet = page.getByRole('region', { name: 'Label sheet' });
  await sheet.waitFor();
  assert.ok(await page.getByRole('button', { name: 'Print labels' }).isEnabled());
  const labels = sheet.getByRole('article');
  await labels.first().getByRole('img', { name: /QR code for/ }).locator('svg').waitFor();
  flow.labels = await Promise.all((await labels.all()).map(async label => ({
    name: await label.getAttribute('aria-label'),
    text: await label.innerText(),
    qr: await label.getByRole('img', { name: /QR code for/ }).locator('svg').count(),
  })));
});

Then('the sheet has six labels, JRA-000301 to JRA-000306', function () {
  const expected = Array.from({ length: 6 }, (_, index) => `Label JRA-${String(301 + index).padStart(6, '0')}`);
  assert.deepEqual(assets(this).labels.map(label => label.name), expected);
});

Then('each label reads {string} and {string} and has a QR code', function (owner, warning) {
  for (const label of assets(this).labels) {
    assert.match(label.text, new RegExp(owner), label.name);
    assert.match(label.text, new RegExp(warning), label.name);
    assert.equal(label.qr, 1, `${label.name} has no QR code`);
  }
});

Given('the {string} carries tag JRA-000301', async function (name) {
  const flow = assets(this);
  const id = await flow.asset(name, 'ATK 1501', { type: 'AC', warranty_until: '2027-03-12', tag_no: 'JRA-000301' });
  assert.equal(tagNumber((await flow.get('equipment.asset', id)).tag_no), 301);
  await flow.setupRow('equipment.job', { asset: id, problem: 'Not cooling' });
  flow.labelled = 'JRA-000301';
});

When('a member scans its label with a phone', async function () {
  const flow = assets(this);
  await this.usePhone();
  const page = await flow.page('a member');
  // The label's QR code holds this address (tagAddress in Tagging.tsx); it opens the asset with that tag.
  await flow.pageText('a member', `tag=${encodeURIComponent(flow.labelled)}`);
  await page.getByRole('heading', { name: 'Voltas 2-ton split AC' }).waitFor();
  await page.waitForLoadState('networkidle');
  flow.shown = await page.locator('main').innerText();
});

Then("the AC's page opens, with its place, warranty and any open repair job", function () {
  const { shown } = assets(this);
  assert.match(shown, /Voltas 2-ton split AC/);
  assert.match(shown, /ATK 1501/);
  assert.match(shown, /12-Mar-2027/);
  assert.match(shown, /Not cooling/);
});
