'use strict';

// Steps over the organisation masters of relational navigation (#910),
// support/organisation.js (Region ← Site Master ← Plant ← Profit Centre ← Cost
// Centre), that capabilities still on cucumber use: search-and-explore's map
// and list-view's compact list and tree of all. relational-navigation itself
// runs as Vitest tests (#1070, apps/web/test/scenarios/). "The user" is the
// seeded System Manager, unless a scenario signs them in again: then they are
// a person who may read the masters, and nothing more.

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('playwright/test');
const { ListPage } = require('../support/pages/list-page');
const { TreeOutline } = require('../support/pages/tree-outline');
const { RelationMapPage } = require('../support/pages/relation-map-page');
const { SITE, seedOrganisation, dropOrganisation, readerRoles, listColumns } = require('../support/organisation');

const WAIT = 10_000;

// ---- the world's part ----

async function seed(world) {
  world.org = await world.withApi((api) => seedOrganisation(api));
  world.seededOrganisation = true;
}

// Other features make a "Plant" table of their own; leave none of ours behind.
After(async function () {
  if (this.seededOrganisation) await this.withApi((api) => dropOrganisation(api));
});

/** "The user" as a person who may read the masters (and so can sign in again). */
async function reader(world) {
  const roles = await world.withApi((api) => readerRoles(api));
  return world.person('the user', roles);
}

/** Page objects over whatever page the user is on now. */
async function on(world) {
  const page = await world.actor();
  world.list = new ListPage(page);
  world.tree = new TreeOutline(page);
  return page;
}

async function openSites(world) {
  await on(world);
  await world.list.open(SITE);
}

async function unfoldRow(world, name, within) {
  const line = world.tree.row(name, within);
  await world.tree.unfold(line);
  return line;
}

// ---- Given: the running example ----

for (const text of [
  'the site Enchakkal is in region Kerala and has three plants',
  'there are four sites, among them Enchakkal',
]) Given(text, async function () { await seed(this); });

Given("the user is looking at Enchakkal's map", async function () {
  await seed(this);
  await on(this);
  this.map = new RelationMapPage(this.list.page);
  await this.map.open(SITE, this.org[SITE].Enchakkal);
});

// ---- list-view: a compact list, and every row as a tree ----

Given('the user switched the list of sites to its compact layout', async function () {
  await seed(this);
  await reader(this);
  await openSites(this);
  await this.list.chooseLayout('Compact');
});

When('the user signs in again and opens the list of sites', async function () {
  await this.signedInAfresh('the user');
  await openSites(this);
});

Then('Enchakkal shows by its name with a few key values', async function () {
  assert.ok(await this.list.layoutChosen('Compact'), 'the list of sites is not compact');
  await expect(this.list.page.getByRole('main').getByText('Enchakkal', { exact: true }).first()).toBeVisible({ timeout: WAIT });
  const headers = await this.list.columnHeaders();
  assert.ok(headers.length < listColumns(SITE).length,
    `the compact list shows every column: ${JSON.stringify(headers)}`);
});

Then('the list of plants still shows all its columns', async function () {
  await this.list.open('Plant');
  assert.ok(!(await this.list.layoutChosen('Compact')), 'the list of plants is compact too');
  const headers = await this.list.columnHeaders();
  for (const label of listColumns('Plant'))
    assert.ok(headers.includes(label), `the list of plants shows ${JSON.stringify(headers)}, without ${label}`);
});

When('the user opens the list of sites as a tree', async function () {
  await openSites(this);
  await this.list.layout('Tree').click({ timeout: WAIT });
  await this.tree.waitFor();
});

Then('the four sites show folded, one line each', async function () {
  const lines = this.tree.topLines();
  await expect(lines).toHaveCount(4, { timeout: WAIT });
  for (const name of ['Enchakkal', 'Attakulangara', 'Pazhavangadi', 'Tenkasi'])
    assert.equal(await this.tree.isUnfolded(this.tree.row(name)), false, `${name} is not folded`);
});

Then('unfolding Enchakkal shows its region and its group of plants', async function () {
  const enchakkal = await unfoldRow(this, 'Enchakkal');
  await expect(enchakkal.getByText(/\bKerala\b/).first(), "Enchakkal's region does not show").toBeVisible({ timeout: WAIT });
  assert.equal(await this.tree.groupCount('Plant', enchakkal), 3);
});
