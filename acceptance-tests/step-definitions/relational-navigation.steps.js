'use strict';

// Steps over the organisation masters of relational navigation (#910),
// support/organisation.js (Region ← Site Master ← Plant ← Profit Centre ← Cost
// Centre), that search-and-explore's map, still on cucumber, uses.
// relational-navigation and list-view themselves run as Vitest tests (#1070,
// apps/web/test/scenarios/). "The user" is the seeded System Manager.

const { Given, After } = require('@cucumber/cucumber');
const { ListPage } = require('../support/pages/list-page');
const { RelationMapPage } = require('../support/pages/relation-map-page');
const { SITE, seedOrganisation, dropOrganisation } = require('../support/organisation');

// ---- the world's part ----

async function seed(world) {
  world.org = await world.withApi((api) => seedOrganisation(api));
  world.seededOrganisation = true;
}

// Other features make a "Plant" table of their own; leave none of ours behind.
After(async function () {
  if (this.seededOrganisation) await this.withApi((api) => dropOrganisation(api));
});

/** Page objects over whatever page the user is on now. */
async function on(world) {
  const page = await world.actor();
  world.list = new ListPage(page);
  return page;
}

// ---- Given: the running example ----

Given('the site Enchakkal is in region Kerala and has three plants', async function () { await seed(this); });

Given("the user is looking at Enchakkal's map", async function () {
  await seed(this);
  await on(this);
  this.map = new RelationMapPage(this.list.page);
  await this.map.open(SITE, this.org[SITE].Enchakkal);
});
