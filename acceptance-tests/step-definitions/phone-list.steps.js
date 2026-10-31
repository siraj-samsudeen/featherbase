'use strict';

// Steps for a list on a phone (usable-on-any-device, "Lists fit a phone"):
// a 375px-wide screen, where a table's list reads as one card per row.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { CHECKLIST_RUN, CHECKLIST_RUN_FIGURES, givenChecklistRun } = require('../support/fixtures/checklist-runs');
const { STOCK_COUNT, OTHER_LISTED, ROW_COUNT, stockCountTables } = require('../support/fixtures/stock-count');
const { sectionMappingTable, COLUMN_NAMES } = require('../support/fixtures/section-mapping');
const { ListPage } = require('../support/pages/list-page');
const { ListCards } = require('../support/pages/list-cards');
const { DEFAULT_LIST, givenTable } = require('../support/lists');

const PAGE_SIZE = 20;

async function openCards(world, table) {
  const page = await world.actor();
  await new ListPage(page).open(table);
  world.cards = new ListCards(page);
  return world.cards;
}

// ---- Given ----

Given('the user is on a phone', async function () {
  await this.usePhone();
});

Given('the table {string} has seven list columns', async function (table) {
  await givenTable(this, sectionMappingTable(DEFAULT_LIST, table));
  assert.equal(this.listColumns.length, 7);
});

// ---- When ----

// "A list" of the scenario "Read a list of checklist runs on a phone": the
// checklists app's runs, with one run seeded through the app's own hooks.
When('the user opens a list', async function () {
  this.run = await this.withApi(givenChecklistRun);
  await openCards(this, CHECKLIST_RUN);
});

When("the user opens any Table's list", async function () {
  const { line, def, rows } = stockCountTables();
  await this.withApi(async (api) => {
    await api.removeTableIfPresent(def.name); // the parent first: it refers to the line table
    await api.createTable(line);
    await api.createTable(def, rows);
  });
  this.stockRows = new Map(rows.map((r) => [r.row_id, r]));
  await openCards(this, STOCK_COUNT);
});

When('the user asks to see them', async function () {
  const cards = this.cards;
  this.urlBeforeMore = cards.page.url();
  await cards.showMore(0);
});

// ---- Then ----

Then('each row shows its title, its status in words and its key figures, without sideways scrolling', async function () {
  const cards = this.cards;
  const count = await cards.count();
  let seen = false;
  for (let n = 0; n < count; n++) {
    const card = await cards.read(n);
    assert.ok(card.title, `card ${n + 1} has no title`);
    assert.notEqual(card.title, card.rowId, `card ${n + 1} is led by its row ID, not a title`);
    assert.ok(card.besideTitle.some((w) => /[A-Za-z]/.test(w)), `card ${n + 1} shows no status in words`);
    assert.ok(card.figures.length > 0, `card ${n + 1} shows no figures`);
    for (const { label } of card.figures)
      assert.ok(CHECKLIST_RUN_FIGURES.includes(label), `card ${n + 1} shows ${label}, not one of the run's figures`);
    if (card.rowId === this.run.row_id) {
      seen = true;
      assert.equal(card.title, this.run.run_title);
      assert.ok(card.besideTitle.includes(this.run.run_status), `the run's status ${this.run.run_status} is not shown`);
    }
  }
  assert.ok(seen, `no card for the run ${this.run.row_id}`);
  assert.ok(await cards.fitTheScreen(), 'the list scrolls sideways on a phone');
});

Then("each row is a card led by the row's title, which opens the row, never by an opaque id", async function () {
  const cards = this.cards;
  const count = await cards.count();
  for (let n = 0; n < count; n++) {
    const card = await cards.read(n);
    const row = this.stockRows.get(card.rowId);
    assert.ok(row, `card ${n + 1} links to ${card.href}, not to one of the rows`);
    assert.equal(card.title, row.item, `card ${n + 1} is not led by its row's title`);
  }
  assert.ok(await cards.fitTheScreen(), 'the list scrolls sideways on a phone');
  const first = await cards.read(0);
  await cards.openRow(0);
  assert.ok(cards.page.url().includes(encodeURIComponent(first.rowId)), `the title opened ${cards.page.url()}`);
  await openCards(this, STOCK_COUNT);
});

Then('the card shows its status in words and up to three other listed columns as labelled figures', async function () {
  const cards = this.cards;
  const count = await cards.count();
  for (let n = 0; n < count; n++) {
    const card = await cards.read(n);
    const row = this.stockRows.get(card.rowId);
    assert.ok(card.besideTitle.includes(row.count_status), `card ${n + 1} does not show its status ${row.count_status}`);
    const labels = card.figures.map((f) => f.label);
    assert.ok(labels.length > 0, `card ${n + 1} shows no figures`);
    assert.ok(labels.length <= 3, `card ${n + 1} shows ${labels.length} figures: ${labels.join(', ')}`);
    for (const label of labels) assert.ok(OTHER_LISTED.includes(label), `card ${n + 1} shows ${label}`);
  }
});

Then('the user can still select rows one at a time or all on the page, and act on them in bulk', async function () {
  const cards = this.cards;
  await cards.select(0);
  assert.equal(await cards.selectedCount(), '1 selected');
  await cards.selectAllOnPage();
  assert.equal(await cards.selectedCount(), `${PAGE_SIZE} selected`);
  const onPage = [];
  for (let n = 0; n < (await cards.count()); n++) onPage.push((await cards.read(n)).rowId);
  await cards.bulkEdit('Shelf', 'Moved');
  const stored = await this.withApi((api) => Promise.all(onPage.map((id) => api.row(STOCK_COUNT, id))));
  assert.deepEqual(stored.map((r) => r.shelf), onPage.map(() => 'Moved'));
});

Then('the user can sort by any listed column, show a row\'s nested rows in place, and page through the rows', async function () {
  const cards = this.cards;
  const offered = await cards.sortChoices();
  for (const label of ['Item', 'Status', ...OTHER_LISTED])
    assert.ok(offered.includes(label), `"Sort by" does not offer ${label}; it offers ${offered.join(', ')}`);
  const last = `Item ${ROW_COUNT}`;
  await cards.sortBy('Item', 'desc');
  assert.equal((await cards.titlesOnceFirstIs(last))[0], last);

  const nested = await cards.showNestedRows(0);
  assert.ok(nested.includes(`Count bin ${ROW_COUNT}`), `the nested rows read: ${nested}`);

  assert.equal(await cards.pageInfo(), `1–${PAGE_SIZE} of ${ROW_COUNT}`);
  await cards.nextPage();
  assert.equal(await cards.pageInfo(), `${PAGE_SIZE + 1}–${ROW_COUNT} of ${ROW_COUNT}`);
  assert.equal(await cards.count(), ROW_COUNT - PAGE_SIZE);
});

/**
 * The given columns a card shows: its labelled figures, and its title when
 * the title is one of those columns' values.
 */
function columnsOnCard(world, card) {
  const row = world.givenRows.find((r) => r.row_id === card.rowId);
  assert.ok(row, `a card links to ${card.href}, not to one of the rows`);
  const title = world.listColumns.filter((label) => row[COLUMN_NAMES[label]] === card.title);
  const figures = card.figures.map((f) => f.label).filter((label) => world.listColumns.includes(label));
  return [...new Set([...title, ...figures])];
}

Then('each card shows three of those columns and says there are {int} more', async function (more) {
  // The list the user just opened, read as cards.
  const cards = (this.cards ??= new ListCards(await this.actor()));
  const count = await cards.count();
  for (let n = 0; n < count; n++) {
    const card = await cards.read(n);
    const shown = columnsOnCard(this, card);
    assert.equal(shown.length, 3, `card ${n + 1} shows ${shown.length} of the columns: ${shown.join(', ')}`);
    assert.match(card.more ?? '', new RegExp(`^${more} more\\b`), `card ${n + 1} says "${card.more}"`);
  }
});

Then('the card shows all seven without leaving the list', async function () {
  const cards = this.cards;
  const card = await cards.read(0);
  const shown = columnsOnCard(this, card);
  assert.deepEqual([...shown].sort(), [...this.listColumns].sort());
  assert.equal(cards.page.url(), this.urlBeforeMore, 'asking for the other columns left the list');
});
