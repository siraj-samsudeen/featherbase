'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFile, unlink } = require('node:fs/promises');
const path = require('node:path');
const { restartAcceptance, REPO_ROOT } = require('../stack');

// Expectations are independent of the fixture's filter definitions and of
// metadata returned by the server. In particular, do not derive the expected
// first request from the request or response under test.
const CHECK = { kind: 'small', quantity: 0, enabled: false, note: 'starting note', as_of: '2026-01-15', include_details: true };
const REVIEW = { kind: 'large', quantity: 7, enabled: true, note: 'review note', as_of: '2026-02-20', include_details: true };
let installed = false;

class ScriptReportPage {
  constructor(page) { this.page = page; }

  static async install(api) {
    if (installed) return;
    const created = [];
    try {
      for (const [key, slug] of [['stockCheck', 'check'], ['stockReview', 'review']]) {
        const file = path.join(REPO_ROOT, 'apps/server/src/reports', `issue778-${slug}-${randomUUID()}.ts`);
        await writeFile(file,
          `import fixtures from '../../../../acceptance-tests/support/fixtures/issue778-script-reports.js'\nexport default fixtures.${key}\n`,
          { flag: 'wx' });
        created.push(file);
      }
      await restartAcceptance();
    } finally {
      await Promise.all(created.map(file => unlink(file)));
    }
    for (const [name, script] of [['Stock Check', 'issue778-stock-check'], ['Stock Review', 'issue778-stock-review']]) {
      await api.saveRow('Report', { row_id: name, ref_table: 'Person', report_type: 'Script Report', report_script: script });
      const response = await api.call('GET', `/api/script_report/${encodeURIComponent(name)}`, undefined, [200], `metadata for ${name}`);
      const meta = await response.json();
      assert.equal(meta.script, script);
      const expected = name === 'Stock Check' ? CHECK : REVIEW;
      assert.deepEqual(Object.fromEntries(meta.filters.map(filter => [filter.column_name, filter.default])), expected);
    }
    await api.saveRow('Home Page', {
      row_id: 'issue778-reports', label: 'Issue 778 reports',
      shortcuts: ['Stock Check', 'Stock Review'].map(name => ({
        label: name, type: 'url', link_to: `/featherbase/admin/script-report/${encodeURIComponent(name)}`,
      })),
    });
    installed = true;
  }

  filter(name) { return this.page.getByTestId(`sr-filter-${name}`); }

  async answerFor(name, action) {
    const responsePromise = this.page.waitForResponse(response => {
      const request = response.request();
      return new URL(response.url()).pathname === '/api/run_script_report' &&
        request.method() === 'POST' && request.postDataJSON().report === name;
    });
    await action();
    const response = await responsePromise;
    assert.equal(response.status(), 200, await response.text());
    const answer = { request: response.request().postDataJSON(), result: await response.json() };
    await this.page.getByTestId('script-report-title').filter({ hasText: name }).waitFor();
    await this.page.getByTestId('script-report-run').filter({ hasText: /^Run$/ }).waitFor();
    await this.page.getByTestId('script-report-rows').waitFor();
    return answer;
  }

  async openCheck() {
    await this.page.goto('/featherbase/admin/home/issue778-reports');
    this.firstCheck = await this.answerFor('Stock Check', () => this.page.getByTestId('shortcut-Stock Check').click());
  }

  async openReview() {
    await this.filter('note').fill('edited check note');
    const marker = randomUUID();
    await this.page.evaluate(value => { window.issue778Document = value; }, marker);
    await this.page.getByTestId('home-page-link-issue778-reports').click();
    this.firstReview = await this.answerFor('Stock Review', () => this.page.getByTestId('shortcut-Stock Review').click());
    assert.equal(await this.page.evaluate(() => window.issue778Document), marker, 'Report navigation must retain the SPA document');
  }

  async screenshot() { return this.page.screenshot({ fullPage: true }); }

  async expectStarting(answer, expected, items) {
    const filters = answer.request.filters;
    // Form controls may serialize numbers as strings; presence and value must
    // still be checked, not collapsed via truthiness or a fallback default.
    assert.ok(Object.hasOwn(filters, 'quantity'), 'first request must explicitly send quantity');
    assert.deepEqual({ ...filters, quantity: Number(filters.quantity) }, expected, 'first automatic request uses declared defaults');
    for (const key of ['kind', 'quantity', 'note', 'as_of'])
      assert.equal(await this.filter(key).inputValue(), String(expected[key]), `${key} control`);
    for (const key of ['enabled', 'include_details'])
      assert.equal(await this.filter(key).isChecked(), expected[key], `${key} control`);
    await this.expectAnswer(answer, {
      items, quantity_received: String(expected.quantity), enabled_received: String(expected.enabled),
      note: expected.note, as_of: expected.as_of, include_details: 'true',
    });
  }

  async expectAnswer(answer, row) {
    assert.deepEqual(answer.result.rows, [row], 'real executed report answer');
    assert.deepEqual(await this.page.getByTestId('script-report-rows').locator('tr').allTextContents(),
      [answer.result.columns.map(column => row[column]).join('')], 'rendered report answer');
  }

  async expectCheckDefaults() { await this.expectStarting(this.firstCheck, CHECK, 'small zero off'); }
  async expectReviewDefaults() { await this.expectStarting(this.firstReview, REVIEW, 'large seven on'); }

  async clearConstraints(note) {
    await this.filter('kind').selectOption('');
    await this.filter('quantity').fill('');
    await this.filter('note').fill(note);
  }

  async runAgain() {
    this.rerun = await this.answerFor('Stock Check', () => this.page.getByTestId('script-report-run').click());
  }

  async expectUnconstrained() {
    for (const key of ['kind', 'quantity']) {
      assert.equal(await this.filter(key).inputValue(), '', `${key} stays cleared`);
      assert.ok(!Object.hasOwn(this.rerun.request.filters, key) || this.rerun.request.filters[key] === '', `${key} is not restored in request`);
    }
    assert.equal(this.rerun.result.rows[0].quantity_received, 'MISSING');
    assert.equal(this.rerun.result.rows[0].items, 'small zero off, small two off, large zero off');
  }

  async expectNote(note) {
    assert.equal(await this.filter('note').inputValue(), note);
    assert.equal(this.rerun.request.filters.note, note);
    await this.expectAnswer(this.rerun, {
      items: 'small zero off, small two off, large zero off', quantity_received: 'MISSING',
      enabled_received: 'false', note, as_of: '2026-01-15', include_details: 'true',
    });
  }
}

module.exports = { ScriptReportPage };
