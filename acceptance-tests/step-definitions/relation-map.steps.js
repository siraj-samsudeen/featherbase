'use strict';

// Steps for reading the relationship map (search-and-explore). "The user" is
// the seeded System Manager.

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { RelationMapPage } = require('../support/pages/relation-map-page');
const { SITE } = require('../support/organisation');

Given('a table of volunteers and a table of chores, each chore assigned to a volunteer', async function () {
  await this.withApi(async (api) => {
    await api.removeTableIfPresent('Chore');
    await api.createTable({
      name: 'Volunteer', id_pattern: 'prompt', title_column: 'title',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'phone', column_type: 'Data', label: 'Phone', in_list_view: true },
      ],
    });
    await api.createTable({
      name: 'Chore', id_pattern: 'prompt', title_column: 'title',
      columns: [
        { column_name: 'title', column_type: 'Data', in_list_view: true },
        { column_name: 'assigned_to', column_type: 'Reference', reference_table: 'Volunteer', label: 'Assigned To', in_list_view: true },
      ],
    });
  });
});

Given('the chore {string} assigned to {string}, whose phone is {string}', async function (chore, volunteer, phone) {
  await this.withApi(async (api) => {
    await api.call('POST', '/api/table/Volunteer', { row_id: 'vol-1', title: volunteer, phone }, [201], 'add the volunteer');
    await api.call('POST', '/api/table/Chore', { row_id: 'chore-1', title: chore, assigned_to: 'vol-1' }, [201], 'add the chore');
  });
  this.volunteer = volunteer;
});

When("the user opens that chore's relationship map", async function () {
  this.map = new RelationMapPage(await this.actor());
  await this.map.open('Chore', 'chore-1');
});

When("the user opens Asha's relationship map", async function () {
  this.map = new RelationMapPage(await this.actor());
  await this.map.open('Volunteer', 'vol-1');
});

Then('the user sees {string}, a {word}, linked by {string}', async function (title, table, link) {
  const box = this.map.linkedRow(table);
  const text = await this.map.boxText(box, title);
  for (const part of [title, table, link])
    assert.ok(text.includes(part), `the ${table} box reads "${text}", without "${part}"`);
});

Then("the user sees Asha's chores related by {string}", async function (link) {
  const box = this.map.collection('Chore');
  const text = await this.map.boxText(box, link);
  assert.ok(text.includes('Chore'), `the chores box reads "${text}", without "Chore"`);
  assert.ok(text.includes(link), `the chores box reads "${text}", without "${link}"`);
  assert.ok(!text.includes('assigned_to'), `the chores box reads "${text}", a technical name`);
});

// ---- Enchakkal's map, a tab of its row page (#910); the masters come from organisation.js ----

When("the user opens the map on Enchakkal's page", async function () {
  this.map = new RelationMapPage(await this.actor());
  await this.map.open(SITE, this.org[SITE].Enchakkal);
});

Then('the map shows Enchakkal pointing at Kerala', async function () {
  await this.map.centredOn('Enchakkal');
  const box = this.map.linkedRow('Region');
  const text = await this.map.boxText(box, 'Kerala');
  assert.ok(text.includes('Kerala'), `the region box reads "${text}", without "Kerala"`);
});

Then('a group of 3 plants pointing back at Enchakkal', async function () {
  const box = this.map.collection('Plant');
  const text = await this.map.boxText(box, '3');
  assert.match(text, /\b3\b/, `the plants box reads "${text}", without a count of 3`);
});

When('the user chooses to centre the map on the region Kerala', async function () {
  await this.map.centreOn('Region');
});

Then('the map re-centres on Kerala, showing what it in turn points to and back from', async function () {
  await this.map.centredOn('Kerala');
  const sites = this.map.collection(SITE);
  const text = await this.map.boxText(sites, '3');
  assert.match(text, /\b3\b/, `Kerala's sites box reads "${text}", without a count of 3`);
});
