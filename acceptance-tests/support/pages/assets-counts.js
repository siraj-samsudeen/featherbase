'use strict';

// Counts and the ATK fresh count in the Assets app, on top of the shared Assets flow
// (support/pages/assets.js). Steps never see a table, field, route or selector: they ask this.
//
// The acceptance database lasts the whole run, and other Assets specs put assets in their own
// "ATK 1501". A count expects every asset in its place, so each counts scenario gets places of
// its own, under the spec's names, instead of the shared ones.

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { acceptanceSql } = require('../stack');

const short = () => randomUUID().slice(0, 8);

class AssetCounts {
  constructor(flow) {
    this.flow = flow;
    this.count = null; // the scenario's count row
    this.removeAfter = []; // [table, row_id] made by a scenario that would trip a later one
  }

  // ---- People the shared cast doesn't name ----

  /** A person the shared cast has no name for ('the site manager'), made like the cast's people. */
  async extra(name, roles) {
    const { flow } = this;
    await flow.setup();
    if (flow.ids[name]) return flow.ids[name];
    const person = await flow.world.person(name, roles);
    const [row] = await flow.list('Person', [['email', '=', person.email]], ['row_id', 'updated_at']);
    const fullName = name.replace(/^(a|an|the|another) /, '').replace(/^\w/, c => c.toUpperCase());
    await flow.setupRow('Person', { row_id: row.row_id, updated_at: row.updated_at, full_name: fullName });
    flow.ids[name] = row.row_id;
    flow.names[row.row_id] = fullName;
    return row.row_id;
  }

  /** Gives a person of the scenario one more Featherbase role. */
  async addRole(name, role) {
    const id = await this.flow.who(name);
    const person = await this.flow.get('Person', id);
    if (person.roles.some(entry => entry.role === role)) return;
    await this.flow.setupRow('Person', { row_id: id, updated_at: person.updated_at, roles: [...person.roles, { role }] });
  }

  /** Names a person as the pilot's asset accountant or finance controller. */
  async financeRole(name, financeRole) {
    await this.flow.setupRow('equipment.finance_person', { person: await this.flow.who(name), finance_role: financeRole });
  }

  // ---- This scenario's places ----

  async site(name = 'ATK 1501', extra = {}) {
    const { flow } = this;
    await flow.setup();
    if (!flow.places[name]) flow.places[name] = (await flow.setupRow('equipment.place', { place_name: name, place_level: 'Site', ...extra })).row_id;
    return flow.places[name];
  }

  async area(name, site = 'ATK 1501') {
    const { flow } = this;
    if (!flow.places[name]) flow.places[name] = (await flow.setupRow('equipment.place', { place_name: name, place_level: 'Area', parent_place: await this.site(site) })).row_id;
    return flow.places[name];
  }

  /** Makes a place's site manager a named person. */
  async siteManager(name, site = 'ATK 1501') {
    const id = await this.site(site);
    const place = await this.flow.get('equipment.place', id);
    await this.flow.setupRow('equipment.place', { row_id: id, updated_at: place.updated_at, site_manager: await this.flow.who(name) });
  }

  // ---- Planning, starting and reviewing a count ----

  /** A manager plans a count of a site, with its counters and reviewer. */
  async plan({ kind = 'Full', site = 'ATK 1501', counters = ['Suresh'], reviewer = 'Meena', by = 'a manager', extra = {} } = {}) {
    const { flow } = this;
    const count = await flow.save(by, 'equipment.count', {
      count_name: `ATK count ${short()}`, scope_place: await this.site(site), count_kind: kind, reviewer: await flow.who(reviewer), ...extra,
    });
    this.count = count;
    for (const counter of counters) await this.addCounter(by, counter);
    return count;
  }

  async addCounter(by, name, attempt = false) {
    return this.flow.save(by, 'equipment.counter', { count: this.count.row_id, person: await this.flow.who(name) }, attempt);
  }

  async current() {
    return this.flow.get('equipment.count', this.count.row_id);
  }

  async start(by = 'a manager') {
    const current = await this.current();
    return this.flow.act(by, 'start_count', { row_id: current.row_id, updated_at: current.updated_at });
  }

  async moveTo(stage, by = 'a manager', attempt = false) {
    const current = await this.current();
    return this.flow.save(by, 'equipment.count', { row_id: current.row_id, updated_at: current.updated_at, count_state: stage }, attempt);
  }

  /** The asset IDs fixed as expected when the count started, as an Assets Manager reads them. */
  async expected() {
    return (await this.flow.list('equipment.count_expected', [['count', '=', this.count.row_id]], ['asset'])).map(row => row.asset);
  }

  /** Asks for the count's expected list as a person; the answer is kept for `refused`. */
  async askExpected(name) {
    const filters = encodeURIComponent(JSON.stringify([['count', '=', this.count.row_id]]));
    return this.flow.call(name, `/api/table/equipment.count_expected?filters=${filters}&fields=["asset"]`, undefined, 'GET');
  }

  /** A counter records an item of the register in an area. */
  async record(name, { asset, area, outcome = 'Found here', ...rest }, attempt = false) {
    const { flow } = this;
    return flow.save(name, 'equipment.scan', {
      count: this.count.row_id, ...(asset ? { asset: flow.assets[asset] } : {}), area: flow.places[area], outcome, ...rest,
    }, attempt);
  }

  /** A counter types an asset's tag by hand. */
  async typeTag(name, asset, area, reason, attempt = false) {
    const { flow } = this;
    return flow.save(name, 'equipment.scan', {
      count: this.count.row_id, typed_tag: flow.assets[asset], area: flow.places[area], outcome: 'Found here', ...(reason ? { reason } : {}),
    }, attempt);
  }

  async scans() {
    return this.flow.list('equipment.scan', [['count', '=', this.count.row_id]], ['row_id', 'asset', 'outcome', 'area', 'duplicate', 'created_by', 'created_at']);
  }

  /** The reviewer decides a missing asset's line. */
  async decide(name, asset, decision) {
    return this.flow.save(name, 'equipment.count_decision', { count: this.count.row_id, asset: this.flow.assets[asset], decision });
  }

  /** Moves a recorded scan back to a past moment: the platform stamps records with the server's clock. */
  async backdate(scanId, instant) {
    const [table] = await acceptanceSql(
      `select table_schema as schema, table_name as name from information_schema.columns
        where column_name = 'typed_tag' and table_name in (select table_name from information_schema.columns where column_name = 'new_tag')`);
    assert.ok(table, 'no table holds count records');
    const updated = await acceptanceSql(`update "${table.schema}"."${table.name}" set created_at = $1 where row_id = $2 returning row_id`, [instant, scanId]);
    assert.equal(updated.length, 1, `record ${scanId} was not found`);
  }

  // ---- Pages ----

  /** The Counts list, as a person sees it: the row of this scenario's count. */
  async countsRow(name) {
    const { flow } = this;
    await flow.pageText(name, 'counts');
    const page = await flow.page(name);
    const row = page.getByRole('table', { name: 'Counts' }).getByRole('row').filter({ hasText: this.count.count_name });
    await row.waitFor();
    return {
      text: await row.innerText(),
      canStart: await row.getByRole('button', { name: 'Start count' }).isVisible(),
    };
  }

  /** A counter's count page, with an area chosen: the areas offered, and the page's text. */
  async counterPage(name, areaName) {
    const { flow } = this;
    await flow.pageText(name, `count=${encodeURIComponent(this.count.row_id)}`);
    const page = await flow.page(name);
    const select = page.getByRole('combobox', { name: 'Area' });
    const areas = (await select.locator('option').allInnerTexts()).filter(label => label !== 'Choose where you are');
    const option = areas.find(label => label.endsWith(areaName));
    assert.ok(option, `${areaName} is not offered: ${areas.join(', ')}`);
    await select.selectOption({ label: option });
    await page.getByRole('status').filter({ hasText: 'You have recorded' }).waitFor();
    return { areas, text: await page.locator('main').innerText() };
  }

  /** The reviewer's page: the names under each heading. */
  async review(name) {
    const { flow } = this;
    await flow.pageText(name, `review=${encodeURIComponent(this.count.row_id)}`);
    const page = await flow.page(name);
    await page.getByRole('table', { name: 'Outcomes' }).waitFor();
    const section = async heading => page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) }).innerText();
    return { missing: await section('Missing'), moved: await section('Moved since the start'), found: await section('Found') };
  }

  // ---- Fresh counts and tags ----

  /** A tag that is on an issued roll; a roll of its own number when no roll holds it. */
  async issuedTag(number) {
    const { flow } = this;
    const rolls = await flow.list('equipment.tag_roll', [], ['first_no', 'last_no']);
    if (!rolls.some(roll => Number(roll.first_no) <= number && number <= Number(roll.last_no)))
      await flow.setupRow('equipment.tag_roll', { roll_name: `Roll ${number}`, first_no: number, last_no: number });
    return `JRA-${String(number).padStart(6, '0')}`;
  }

  /** An issued tag nothing carries yet. */
  async freshTag() {
    for (;;) {
      const tag = `JRA-${String(300000 + Math.floor(Math.random() * 600000)).padStart(6, '0')}`;
      const used = [...await this.flow.list('equipment.count_line', [['tag_no', '=', tag]], ['row_id']), ...await this.flow.list('equipment.asset', [['tag_no', '=', tag]], ['row_id'])];
      if (!used.length) return this.issuedTag(Number(tag.slice(4)));
    }
  }

  /** Frees a tag an earlier scenario left on a register asset. */
  async freeTag(tag) {
    for (const asset of await this.flow.list('equipment.asset', [['tag_no', '=', tag]], ['row_id'])) await this.remove('equipment.asset', asset.row_id);
  }

  async remove(table, id) {
    const { updated_at: updatedAt } = await this.flow.get(table, id);
    const response = await this.flow.call('the user', `/api/table/${encodeURIComponent(table)}/${encodeURIComponent(id)}?updated_at=${encodeURIComponent(updatedAt)}`, undefined, 'DELETE');
    assert.ok(response.status < 300, `remove ${id}: ${response.status} ${JSON.stringify(response.body)}`);
  }

  /** A manager plans and starts a fresh inventory count of a site with its two-person team. */
  async freshCount(team, site = 'ATK 1501') {
    await this.plan({ kind: 'Fresh inventory', site, counters: team, reviewer: 'a manager' });
    await this.start();
    return this.count;
  }

  /** One count sheet line, recorded by one team member and initialled by the other. */
  async line(name, { tag, taggedBy, area, ...rest }, attempt = false) {
    const { flow } = this;
    return flow.save(name, 'equipment.count_line', {
      count: this.count.row_id, place: flow.places[area], asset_type: await flow.type('Display chiller'), asset_name: '3-door upright chiller',
      tag_status: 'Tagged', tag_no: tag, ownership: 'Group owned', condition: 'Working', usage: 'In use', tagged_by: await flow.who(taggedBy), ...rest,
    }, attempt);
  }

  /** The lines of one area of the fresh count, as a person sees them. */
  async freshLines(name, areaName) {
    const { flow } = this;
    await flow.pageText(name, `count=${encodeURIComponent(this.count.row_id)}`);
    const page = await flow.page(name);
    const select = page.getByRole('combobox', { name: 'Area' });
    const option = (await select.locator('option').allInnerTexts()).find(label => label.endsWith(areaName));
    assert.ok(option, `${areaName} is not offered`);
    await select.selectOption({ label: option });
    const table = page.getByRole('table', { name: 'Count lines' });
    await table.getByRole('row').nth(1).waitFor();
    return table.innerText();
  }
}

const counts = flow => (flow.counts ??= new AssetCounts(flow));

module.exports = { counts };
