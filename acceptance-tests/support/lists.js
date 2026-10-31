'use strict';

// The table a list scenario is about, its readers, and each person's open
// list of it. Shared by the step files: steps stay intent, this holds the
// bookkeeping.

const { SECTION_MAPPING_COLUMNS } = require('./fixtures/section-mapping');
const { ListPage } = require('./pages/list-page');

// The list columns a new Section Mapping starts with: its first seven.
const DEFAULT_LIST = SECTION_MAPPING_COLUMNS.slice(0, 7);

/** Creates the table, lets a reader role read it, and names its readers. */
async function givenTable(world, { def, rows, rowIds }) {
  world.readerRole = await world.withApi(async (api) => {
    await api.createTable(def, rows);
    return api.readerRoleFor(def.name);
  });
  world.table = def.name;
  world.tableColumns = def.columns.map((c) => c.label);
  world.listColumns = def.columns.filter((c) => c.in_list_view).map((c) => c.label);
  world.rowIds = rowIds;
  world.givenRows = rows;
  await world.person('the user', [world.readerRole]);
  await world.person('a colleague', [world.readerRole]);
}

/** That person's list of the scenario's table, opened if it is not already. */
async function listOf(world, who, table = world.table) {
  const list = new ListPage(await world.signedIn(who));
  if (world.openList?.[who] !== table) {
    await list.open(table);
    world.openList = { ...world.openList, [who]: table };
  }
  return list;
}

/** That person's list of the table, opened afresh so it reads what is saved now. */
async function freshListOf(world, who, table = world.table) {
  const list = new ListPage(await world.signedIn(who));
  await list.open(table);
  world.openList = { ...world.openList, [who]: table };
  return list;
}

/** The System Manager's list of the scenario's table, opened afresh. */
async function systemManagersList(world, table = world.table) {
  const list = new ListPage(await world.asSystemManager());
  await list.open(table);
  return list;
}

module.exports = { DEFAULT_LIST, givenTable, listOf, freshListOf, systemManagersList };
