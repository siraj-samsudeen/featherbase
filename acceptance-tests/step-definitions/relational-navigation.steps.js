'use strict';

// Steps for relational navigation (#910): the drill pane, the path, a row
// page's Form · Map · Tree, over the organisation masters of
// support/organisation.js (Region ← Site Master ← Plant ← Profit Centre ← Cost
// Centre). "The user" is the seeded System Manager, unless a scenario signs
// them in again or limits what they read: then they are a person who may
// read the masters, and nothing more.

const assert = require('node:assert/strict');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { expect } = require('playwright/test');
const { ListPage } = require('../support/pages/list-page');
const { DrillPane } = require('../support/pages/drill-pane');
const { PathBar } = require('../support/pages/path-bar');
const { RowPage } = require('../support/pages/row-page');
const { TreeOutline } = require('../support/pages/tree-outline');
const { RelationMapPage } = require('../support/pages/relation-map-page');
const { tableHref } = require('../support/addresses');
const {
  add, SITE, seedOrganisation, dropOrganisation, readerRoles, limitRows, listColumns, PLANTS,
} = require('../support/organisation');

const WAIT = 10_000;
const ENCHAKKAL_PLANTS = PLANTS.filter((p) => p.site === 'Enchakkal').map((p) => p.name);

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
  world.pane = new DrillPane(page);
  world.path = new PathBar(page);
  world.row = new RowPage(page);
  world.tree = new TreeOutline(page);
  return page;
}

async function openSites(world) {
  await on(world);
  await world.list.open(SITE);
  world.listBefore = await world.list.snapshot();
}

async function selectInSites(world, name) {
  await openSites(world);
  await world.list.select(name);
  await world.pane.shows(name);
}

async function drillToSupermarket(world) {
  await world.pane.openGroup('Enchakkal', 'Plant');
  await world.pane.drillTo('Enchakkal', 'Enchakkal Supermarket');
  await world.pane.shows('Enchakkal Supermarket');
}

/** Sites list narrowed to Kerala from Enchakkal's pane, then drilled to the supermarket. */
async function walkThroughKerala(world) {
  await selectInSites(world, 'Enchakkal');
  await world.pane.filterBy('Enchakkal', 'Kerala');
  await sitesNarrowedToKerala(world.list);
  await world.pane.shows('Enchakkal');
  await drillToSupermarket(world);
}

async function sitesNarrowedToKerala(list) {
  await expect.poll(() => list.rowTexts(), { timeout: WAIT, message: 'the list of sites is not narrowed to Kerala' })
    .toHaveLength(3);
  const rows = await list.rowTexts();
  assert.ok(!rows.some((r) => r.includes('Tenkasi')), `a site outside Kerala is listed: ${JSON.stringify(rows)}`);
  assert.ok((await list.filterWords()).some((w) => w.includes('Kerala')), `no filter reads Kerala: ${JSON.stringify(await list.filterWords())}`);
}

async function openTree(world, table, rowId) {
  await on(world);
  await world.row.open(table, rowId);
  await world.row.showTab('Tree');
  await world.tree.waitFor();
}

async function unfoldRow(world, name, within) {
  const line = world.tree.row(name, within);
  await world.tree.unfold(line);
  return line;
}

async function unfoldGroup(world, table, within) {
  const line = world.tree.group(table, within);
  await world.tree.unfold(line);
  return line;
}

/** Enchakkal's tree unfolded: plants, the supermarket's profit centres, EKL - Retail (All). */
async function unfoldToRetail(world) {
  await openTree(world, SITE, world.org[SITE].Enchakkal);
  const plants = await unfoldGroup(world, 'Plant');
  const supermarket = await unfoldRow(world, 'Enchakkal Supermarket', plants);
  const profitCentres = await unfoldGroup(world, 'Profit Centre', supermarket);
  return unfoldRow(world, 'EKL - Retail (All)', profitCentres);
}

async function stillCentredOnEnchakkal(world) {
  await expect(world.row.heading()).toContainText('Enchakkal', { timeout: WAIT });
  await expect(world.row.heading()).not.toContainText('Kerala');
  assert.ok(new URL(world.list.page.url()).pathname.includes(encodeURIComponent(world.org[SITE].Enchakkal)),
    `the page moved away from Enchakkal, to ${world.list.page.url()}`);
}

// ---- Given: the running example ----

for (const text of [
  'the site Enchakkal is in region Kerala and has three plants',
  'the site Enchakkal is in region Kerala',
  'the plant Enchakkal Supermarket has the plant code 1503',
  'the site Enchakkal has a long note and two empty fields',
  'the site Enchakkal has three plants',
  "Enchakkal Supermarket is one of Enchakkal's plants",
  'Enchakkal Supermarket has 40 profit centres',
  'there are four sites, among them Enchakkal',
]) Given(text, async function () { await seed(this); });

// ---- The drill pane beside a list ----

When('the user selects Enchakkal in the list of sites', async function () {
  await openSites(this);
  await this.list.select('Enchakkal');
});

Then('the drill pane shows that Enchakkal points at the region Kerala', async function () {
  await this.pane.shows('Enchakkal');
  await expect(this.pane.part('Enchakkal', 'Points at')).toContainText('Kerala', { timeout: WAIT });
});

Then('it shows a group of 3 plants that point at Enchakkal', async function () {
  assert.equal(await this.pane.groupCount('Enchakkal', 'Plant'), 3);
});

Then('the list of sites stays as it was', async function () {
  assert.deepEqual(await this.list.snapshot(), this.listBefore);
});

When('the user opens the list of profit centres', async function () {
  await on(this);
  await this.list.open('Profit Centre');
});

Then("each profit centre's plant reads {string}", async function (words) {
  await expect.poll(async () => [...new Set(await this.list.columnValues('Plant'))].map((t) => t.trim()),
    { timeout: WAIT, message: "the profit centres' plant does not read by name and code" }).toEqual([words]);
});

When("the user clicks Kerala in Enchakkal's line of the list of sites", async function () {
  await openSites(this);
  await this.list.clickLinkIn('Enchakkal', 'Kerala');
});

Then(/^([A-Z][\w-]*) shows in the drill pane$/, async function (name) {
  await this.pane.shows(name);
});

Given('the user has Enchakkal open in the drill pane', async function () {
  await seed(this);
  await selectInSites(this, 'Enchakkal');
});

Given('the user has Enchakkal open in the drill pane over the list of sites', async function () {
  await seed(this);
  await selectInSites(this, 'Enchakkal');
});

When('the user opens its group of plants and clicks Enchakkal Supermarket', async function () {
  await this.pane.openGroup('Enchakkal', 'Plant');
  await this.pane.drillTo('Enchakkal', 'Enchakkal Supermarket');
});

Then('the drill pane shows Enchakkal Supermarket and what points at it', async function () {
  await this.pane.shows('Enchakkal Supermarket');
  await expect(this.pane.part('Enchakkal Supermarket', 'Pointed at by')).toBeVisible({ timeout: WAIT });
  assert.equal(await this.pane.groupCount('Enchakkal Supermarket', 'Profit Centre'), 40);
});

When('the user opens its group of plants', async function () {
  await this.pane.openGroup('Enchakkal', 'Plant');
});

Then('the 3 plants show with the columns of the list of plants', async function () {
  await expect(this.pane.groupRows('Enchakkal')).toHaveCount(3, { timeout: WAIT });
  const rows = await this.pane.groupRowTexts('Enchakkal');
  for (const name of ENCHAKKAL_PLANTS)
    assert.ok(rows.some((r) => r.includes(name)), `${name} is not among the plants: ${JSON.stringify(rows)}`);
  const columns = await this.pane.groupColumns('Enchakkal');
  for (const label of listColumns('Plant'))
    assert.ok(columns.includes(label), `the plants show the columns ${JSON.stringify(columns)}, without ${label}`);
});

When('the user opens its group of plants as a list', async function () {
  await this.pane.openGroup('Enchakkal', 'Plant');
  await this.pane.openGroupAsList('Enchakkal');
});

Then('the list of plants opens, narrowed to the 3 plants of Enchakkal', async function () {
  const page = this.list.page;
  await page.waitForURL((url) => url.pathname === tableHref('Plant'), { timeout: WAIT });
  const plants = new ListPage(page);
  await expect.poll(() => plants.rowTexts(), { timeout: WAIT, message: 'the list of plants is not narrowed to Enchakkal' })
    .toHaveLength(3);
  const rows = await plants.rowTexts();
  for (const name of ENCHAKKAL_PLANTS)
    assert.ok(rows.some((r) => r.includes(name)), `${name} is not listed: ${JSON.stringify(rows)}`);
  assert.ok((await plants.filterWords()).length > 0, 'the list shows no filter');
});

When("the user narrows the list by Enchakkal's region Kerala", async function () {
  await this.pane.filterBy('Enchakkal', 'Kerala');
});

Then('the list of sites shows only sites in Kerala', async function () {
  assert.equal(new URL(this.list.page.url()).pathname, tableHref(SITE));
  await sitesNarrowedToKerala(this.list);
});

Then("the filter shows as one of the list's filters, which the user can remove", async function () {
  const words = await this.list.filterWords();
  assert.ok(words.some((w) => w.includes('Kerala')), `the list's filters read ${JSON.stringify(words)}`);
  await expect(this.list.removeFilterControls().first()).toBeVisible();
});

When("the user reads Enchakkal's fields in the drill pane", async function () {
  await selectInSites(this, 'Enchakkal');
  await this.pane.showFields('Enchakkal');
});

Then('the note is shortened with a way to read all of it', async function () {
  const more = this.pane.readMore('Enchakkal');
  await expect(more, 'the long note offers no "Show more"').toBeVisible({ timeout: WAIT });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
});

Then('the two empty fields are folded away under a count', async function () {
  await expect(this.pane.emptyFields('Enchakkal')).toHaveText('2 empty fields', { timeout: WAIT });
});

Then("the user can open Enchakkal's form to edit it", async function () {
  await this.pane.openRowPage('Enchakkal').click({ timeout: WAIT });
  const page = this.list.page;
  await page.waitForURL((url) => url.pathname.startsWith(`${tableHref(SITE)}/row/`), { timeout: WAIT });
  const name = page.getByTestId('form-view').getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Enchakkal', { timeout: WAIT });
  await expect(name).toBeEditable();
});

// ---- The path ----

Given('the user narrowed the list of sites to Kerala, selected Enchakkal and drilled to Enchakkal Supermarket', async function () {
  await seed(this);
  await walkThroughKerala(this);
});

When('the user chooses the step named Enchakkal on the path', async function () {
  await this.path.choose(/(^|\s)Enchakkal$/);
});

Then('the drill pane shows Enchakkal again with the same group open', async function () {
  await this.pane.shows('Enchakkal');
  assert.ok(await this.pane.groupIsOpen('Enchakkal', 'Plant'), "Enchakkal's group of plants is not open");
});

Then('the list of sites is still narrowed to Kerala', async function () {
  await sitesNarrowedToKerala(this.list);
});

Given('the user drilled from Enchakkal to Enchakkal Supermarket', async function () {
  await seed(this);
  await selectInSites(this, 'Enchakkal');
  await drillToSupermarket(this);
});

When("the user presses the browser's back button", async function () {
  await this.list.page.goBack();
});

Then('the drill pane shows Enchakkal again', async function () {
  await this.pane.shows('Enchakkal');
});

Then('going forward shows Enchakkal Supermarket again', async function () {
  await this.list.page.goForward();
  await this.pane.shows('Enchakkal Supermarket');
});

Given('the user copied the link of the step showing Enchakkal Supermarket', async function () {
  await seed(this);
  await walkThroughKerala(this);
  this.link = await this.path.copyLink();
});

When('a colleague who can read sites and plants opens that link', async function () {
  // Kerala names the filter, so the colleague reads regions too.
  const roles = await this.withApi((api) => readerRoles(api, ['Region', SITE, 'Plant']));
  await this.person('a colleague', roles);
  const page = await this.signedIn('a colleague');
  await page.goto(this.link);
  this.colleague = { list: new ListPage(page), pane: new DrillPane(page) };
});

Then('the colleague sees the list of sites narrowed to Kerala', async function () {
  const { list } = this.colleague;
  assert.equal(new URL(list.page.url()).pathname, tableHref(SITE));
  await sitesNarrowedToKerala(list);
});

Then('Enchakkal Supermarket in the drill pane', async function () {
  await this.colleague.pane.shows('Enchakkal Supermarket');
});

Given('the user walked from the list of sites to Enchakkal Supermarket yesterday', async function () {
  await seed(this);
  await reader(this);
  await selectInSites(this, 'Enchakkal');
  await drillToSupermarket(this);
  await this.list.page.waitForLoadState('networkidle');
});

When('the user signs in today and looks at their recent paths', async function () {
  await this.signedInAfresh('the user');
  await openSites(this);
  this.recent = await this.path.openRecent();
});

Then('that path is listed by its names', async function () {
  const items = (await this.recent.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  assert.ok(items.some((t) => t.includes('Enchakkal Supermarket')), `the recent paths read ${JSON.stringify(items)}`);
});

Then('choosing it brings back Enchakkal Supermarket in the drill pane', async function () {
  await this.recent.filter({ hasText: 'Enchakkal Supermarket' }).first().click();
  await this.pane.shows('Enchakkal Supermarket');
});

// ---- Where the pane sits ----

Given('the user fixed the drill pane below the list', async function () {
  await seed(this);
  await reader(this);
  await selectInSites(this, 'Enchakkal');
  const below = this.pane.placeChoice('Bottom');
  await below.waitFor({ timeout: WAIT });
  await this.list.saving(() => below.click());
});

When('the user signs in again and selects Enchakkal', async function () {
  await this.signedInAfresh('the user');
  await openSites(this);
  await this.list.select('Enchakkal');
});

Then('the drill pane opens below the list', async function () {
  await this.pane.shows('Enchakkal');
  const pane = await this.pane.pane('Enchakkal').boundingBox();
  const lastRow = await this.list.rows().last().boundingBox();
  assert.ok(pane && lastRow, 'the pane or the list is not on screen');
  assert.ok(pane.y >= lastRow.y + lastRow.height - 1,
    `the pane starts at ${pane.y}px, above the list's last row ending at ${lastRow.y + lastRow.height}px`);
});

// ---- A row page: connections, Form · Map · Tree ----

When("the user opens Enchakkal's page", async function () {
  await on(this);
  await this.row.open(SITE, this.org[SITE].Enchakkal);
});

Then('its region Kerala and a group of 3 plants show under its name', async function () {
  const kerala = this.row.pointsAt('Kerala');
  await expect(kerala, "Kerala does not show under Enchakkal's name").toBeVisible({ timeout: WAIT });
  assert.ok((await this.row.belowName(kerala)) >= 0, "Kerala shows above Enchakkal's name");
  assert.equal(await this.row.groupCount('Plant'), 3);
  assert.ok((await this.row.belowName(this.row.group('Plant'))) >= 0, "the plants show above Enchakkal's name");
});

Then('opening the plants shows them in the drill pane', async function () {
  await this.row.group('Plant').click();
  await this.pane.shows('Enchakkal');
  const rows = await this.pane.groupRowTexts('Enchakkal');
  for (const name of ENCHAKKAL_PLANTS)
    assert.ok(rows.some((r) => r.includes(name)), `${name} is not in the drill pane: ${JSON.stringify(rows)}`);
});

Given("the user expanded Enchakkal's plants on its tree", async function () {
  await seed(this);
  await openTree(this, SITE, this.org[SITE].Enchakkal);
  await unfoldGroup(this, 'Plant');
});

When('the user switches to the form and back to the tree', async function () {
  await this.row.showTab('Form');
  await this.row.showTab('Tree');
});

Then("Enchakkal's plants are still expanded", async function () {
  assert.ok(await this.tree.isUnfolded(this.tree.group('Plant')), "Enchakkal's plants are folded again");
  await expect(this.tree.row('Enchakkal Supermarket')).toBeVisible({ timeout: WAIT });
});

Given("the user is looking at Enchakkal's map", async function () {
  await seed(this);
  await on(this);
  this.map = new RelationMapPage(this.list.page);
  await this.map.open(SITE, this.org[SITE].Enchakkal);
});

When('the user clicks the region Kerala on the map', async function () {
  await this.map.clickLinked('Region');
});

Then('the map is still centred on Enchakkal', async function () {
  await this.map.centredOn('Enchakkal');
});

Then('choosing to centre on Kerala redraws the map around Kerala', async function () {
  await this.map.centreOn('Region');
  await this.map.centredOn('Kerala');
  await expect(this.map.collection(SITE)).toBeVisible({ timeout: WAIT });
});

Given("the user unfolded Enchakkal's tree down to the cost centre EKL-Marketing", async function () {
  await seed(this);
  const retail = await unfoldToRetail(this);
  await unfoldGroup(this, 'Cost Centre', retail);
  await expect(this.tree.row('EKL-Marketing')).toBeVisible({ timeout: WAIT });
});

When('the user clicks EKL-Marketing on the tree', async function () {
  await this.tree.click('EKL-Marketing');
});

Then('the tree is still centred on Enchakkal', async function () {
  await stillCentredOnEnchakkal(this);
  await expect(this.tree.tree()).toBeVisible();
});

When("the user unfolds Enchakkal's plants, then Enchakkal Supermarket's profit centres, then EKL - Retail \\(All)", async function () {
  this.retail = await unfoldToRetail(this);
});

Then('the cost centres of EKL - Retail \\(All) show beneath it', async function () {
  assert.equal(await this.tree.groupCount('Cost Centre', this.retail), 4);
  const retail = await this.tree.top(this.tree.row('EKL - Retail (All)'));
  assert.ok((await this.tree.top(this.tree.group('Cost Centre', this.retail))) > retail, 'the cost centres show above EKL - Retail (All)');
});

Then('the region Kerala shows above Enchakkal', async function () {
  const kerala = await this.tree.top(this.tree.row('Kerala'));
  const enchakkal = await this.tree.top(this.tree.tree().getByText(/^\W*Enchakkal(?![\w ]*\w)/).first());
  assert.ok(kerala < enchakkal, `Kerala (at ${kerala}px) does not show above Enchakkal (at ${enchakkal}px)`);
});

When('the user unfolds them on the tree', async function () {
  await openTree(this, 'Plant', '1503');
  this.profitCentres = await unfoldGroup(this, 'Profit Centre');
});

Then('the first 20 profit centres show, with a way to show all 40', async function () {
  await expect(this.tree.rowsOf(this.profitCentres)).toHaveCount(20, { timeout: WAIT });
  await expect(this.tree.showAll(this.profitCentres, 40), 'nothing offers all 40 profit centres').toBeVisible();
});

// ---- Rows the user cannot read ----

Given("the user may read sites but not one of Enchakkal's three plants", async function () {
  await seed(this);
  const person = await reader(this);
  this.hiddenPlant = 'Enchakkal Hardware';
  const readable = PLANTS.filter((p) => p.name !== this.hiddenPlant).map((p) => p.row_id);
  await this.withApi((api) => limitRows(api, person.email, 'Plant', readable));
});

When('the user opens Enchakkal in the drill pane and on its tree', async function () {
  await selectInSites(this, 'Enchakkal');
  this.seen = { paneCount: await this.pane.groupCount('Enchakkal', 'Plant') };
  await this.pane.openGroup('Enchakkal', 'Plant');
  await this.pane.groupRows('Enchakkal').first().waitFor({ timeout: WAIT });
  this.seen.paneText = await this.list.page.locator('body').innerText();
  await openTree(this, SITE, this.org[SITE].Enchakkal);
  this.seen.treeCount = await this.tree.groupCount('Plant');
  await unfoldGroup(this, 'Plant');
  await expect(this.tree.row('Enchakkal Supermarket')).toBeVisible({ timeout: WAIT });
  this.seen.treeText = await this.list.page.locator('body').innerText();
});

Then('the group of plants counts 2', async function () {
  assert.equal(this.seen.paneCount, 2, 'the drill pane counts the plant the user may not read');
  assert.equal(this.seen.treeCount, 2, 'the tree counts the plant the user may not read');
});

Then('the name of the third plant shows nowhere', async function () {
  for (const [where, text] of [['the drill pane', this.seen.paneText], ['the tree', this.seen.treeText]])
    assert.ok(!text.includes(this.hiddenPlant), `${where} names ${this.hiddenPlant}`);
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

// ---- Two links from one table; a new row from a group ----

Given('each cost centre names a supplying plant and a billing plant', async function () { await seed(this); });

Given('Enchakkal Supermarket supplies 8 cost centres and bills none', async function () {
  const plant = this.org.Plant['Enchakkal Supermarket'];
  const profitCentre = this.org['Profit Centre']['EKL - Retail (All)'];
  await this.withApi(async (api) => {
    for (let i = 1; i <= 8; i++)
      await add(api, 'Cost Centre', { row_id: `15039900${i}`, name: `EKL-Supply ${i}`, profit_centre: profitCentre, supplying_plant: plant });
  });
});

When('the user opens Enchakkal Supermarket in the drill pane', async function () {
  await on(this);
  await this.list.open('Plant');
  await this.list.select('Enchakkal Supermarket');
  await this.pane.shows('Enchakkal Supermarket');
});

/** A group named by its table and the link it comes through: "Cost Centre · Supplying plant 8". */
const viaGroup = (world, link, count) => world.pane.pane('Enchakkal Supermarket')
  .getByRole('button', { name: new RegExp(`^Cost Centres? · ${link}\\s*${count}$`, 'i') });

Then('a group of 8 cost centres by supplying plant shows', async function () {
  await expect(viaGroup(this, 'Supplying plant', 8)).toBeVisible({ timeout: WAIT });
});

Then('a group of 0 cost centres by billing plant shows, quieter than the other', async function () {
  const empty = viaGroup(this, 'Billing plant', 0);
  await expect(empty).toBeVisible({ timeout: WAIT });
  const colour = (locator) => locator.evaluate((el) => getComputedStyle(el).color);
  assert.notEqual(await colour(empty), await colour(viaGroup(this, 'Supplying plant', 8)), 'the empty group reads like the full one');
});

Given("the user may add plants and has Enchakkal's plants open as a list", async function () {
  await seed(this);
  await selectInSites(this, 'Enchakkal');
  await this.pane.openGroup('Enchakkal', 'Plant');
  await this.pane.openGroupAsList('Enchakkal');
  await this.list.page.waitForURL((url) => url.pathname === tableHref('Plant'), { timeout: WAIT });
});

When('the user starts a new plant', async function () {
  const page = this.list.page;
  await page.getByRole('link', { name: 'New', exact: true }).click({ timeout: WAIT });
  await page.waitForURL((url) => url.pathname === `${tableHref('Plant')}/new`, { timeout: WAIT });
});

Then("the new plant's site is already Enchakkal", async function () {
  const site = this.list.page.getByTestId('form-view').getByLabel('Site', { exact: true });
  await expect(site).toHaveValue('Enchakkal', { timeout: WAIT });
});
