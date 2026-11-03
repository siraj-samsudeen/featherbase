'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { acceptanceSql } = require('../stack');

class SystemHomePage {
  constructor(page) { this.page = page; }

  async rememberCatalogue() {
    // The actor is Administrator, so every standalone system Table is readable.
    // Query metadata, not the home-pages response whose completeness is at issue.
    this.catalogue = await acceptanceSql(`
      select name, coalesce(nullif(label, ''), name) as label
      from featherbase.table_def where system = true and kind != 'sub_table'
      order by name collate "C"`);
    this.hints = await acceptanceSql(`
      select label, type, link_to from featherbase.home_page_link
      where parent = 'system' and parenttype = 'Home Page'
      order by position, row_id`);
    assert.ok(this.catalogue.length > 0, 'the baseline must contain system Tables');
    assert.ok(this.hints.some(hint => hint.type === 'Card Break'), 'the baseline must contain curated groups');
  }

  expectedGroups() {
    const eligible = new Map(this.catalogue.map(table => [table.name, table]));
    const seen = new Set();
    const groups = [];
    let current;
    for (const hint of this.hints) {
      if (hint.type === 'Card Break') {
        current = { heading: hint.label || 'Tables', links: [] };
        groups.push(current);
      } else if (eligible.has(hint.link_to) && !seen.has(hint.link_to)) {
        if (!current) { current = { heading: 'Tables', links: [] }; groups.push(current); }
        current.links.push(eligible.get(hint.link_to));
        seen.add(hint.link_to);
      }
    }
    return {
      curated: groups.filter(group => group.links.length > 0),
      unplaced: this.catalogue.filter(table => !seen.has(table.name)),
    };
  }

  async open() {
    await this.page.goto('/featherbase/admin/home/system');
    await this.page.getByTestId('home-page-title').waitFor();
    assert.equal((await this.page.getByTestId('home-page-title').innerText()).trim(), 'System');
  }

  async cards() {
    return this.page.getByTestId('home-page-cards').locator(':scope > div').evaluateAll(cards => cards.map(card => ({
      heading: card.querySelector('[data-testid="home-card-heading"]').textContent.trim(),
      links: [...card.querySelectorAll('a')].map(link => ({
        name: decodeURIComponent(new URL(link.href).pathname.split('/').pop()),
        label: link.textContent.trim(),
        path: new URL(link.href).pathname,
      })),
    })));
  }

  expectedLinks(tables) {
    return tables.map(table => ({ name: table.name, label: table.label, path: `/featherbase/admin/${encodeURIComponent(table.name)}` }));
  }

  async expectStoredGroups() {
    const { curated } = this.expectedGroups();
    const actual = await this.cards();
    assert.deepEqual(actual.slice(0, curated.length).map(card => card.heading), curated.map(group => group.heading));
    for (const [index, group] of curated.entries())
      assert.deepEqual(actual[index].links.slice(0, group.links.length), this.expectedLinks(group.links),
        'stored system groups and their link order must be retained with effective labels');
  }

  async expectUnplacedTables() {
    const { curated, unplaced } = this.expectedGroups();
    assert.ok(unplaced.length > 0, 'the baseline must exercise unplaced Tables');
    const expected = curated.map(group => ({ heading: group.heading, links: this.expectedLinks(group.links) }));
    let platform = expected.find(card => card.heading === 'Platform');
    if (!platform) { platform = { heading: 'Platform', links: [] }; expected.push(platform); }
    platform.links.push(...this.expectedLinks(unplaced));
    assert.deepEqual(await this.cards(), expected, 'unmatched system Tables must be appended in name order');
  }

  async expectCompleteCatalogue() {
    const links = (await this.cards()).flatMap(card => card.links);
    const actual = links.toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    assert.deepEqual(actual, this.expectedLinks(this.catalogue), 'System must show exactly the eligible catalogue, including Settings and excluding sub-tables');
  }

  async createUnplacedTable() {
    const suffix = randomUUID().replaceAll('-', '');
    this.fixture = { name: `Acceptance System ${suffix}`, relation: `acceptance_system_${suffix}`, label: 'New acceptance system Table' };
    // Privileged fixture: public table creation deliberately rejects system=true.
    // No navigation helper or public table-create endpoint is called.
    await acceptanceSql(`create table featherbase.${this.fixture.relation} (row_id text primary key)`);
    await acceptanceSql(`insert into featherbase.table_def (name, module, system, kind, label)
      values ($1, 'Core', true, 'table', $2)`, [this.fixture.name, this.fixture.label]);
    const links = await acceptanceSql('select row_id from featherbase.home_page_link where link_to = $1', [this.fixture.name]);
    assert.equal(links.length, 0, 'the fixture must have no navigation entry anywhere');
  }

  async expectNewTable() {
    const platform = (await this.cards()).filter(card => card.heading === 'Platform');
    assert.equal(platform.length, 1, 'System must have a Platform group');
    assert.deepEqual(platform[0].links.filter(link => link.name === this.fixture.name), this.expectedLinks([this.fixture]));
    assert.equal((await this.cards()).flatMap(card => card.links).filter(link => link.name === this.fixture.name).length, 1);
  }

  async cleanup() {
    if (!this.fixture) return;
    try { await acceptanceSql('delete from featherbase.table_def where name = $1', [this.fixture.name]); }
    finally { await acceptanceSql(`drop table if exists featherbase.${this.fixture.relation}`); }
  }
}

module.exports = { SystemHomePage };
