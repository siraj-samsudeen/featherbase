'use strict';

const assert = require('node:assert/strict');
const { access } = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { AppNavigation } = require('./app-navigation');
const { SYSTEM_MANAGER } = require('../api');

const ROOT = path.resolve(__dirname, '../../..');

class AppDocument extends AppNavigation {
  async missingPiece() { this.response = await this.page.goto('/tasker/missing-navigation-proof.js'); }
  async expectMissing() { assert.equal(this.response.status(), 404); }
  async expectNotReplaced() {
    assert.equal(await this.page.getByTestId('task-management-page').count(), 0);
    assert.equal(await this.page.getByTestId('admin-sidebar').count(), 0);
  }
  async signInAtTask(api) {
    await AppNavigation.install(api);
    const tasker = await AppNavigation.appApi(api, 'tasker');
    const task = await tasker.saveRow('tasker.task', { task_title: 'Selected nested task' });
    this.deepPath = `/tasker/review/37?filter=a%26b&owner=me#task=${task.row_id}`;
    await this.page.goto(this.deepPath);
    await this.page.locator('input[name=email]').fill(SYSTEM_MANAGER.user);
    await this.page.locator('input[name=password]').fill(SYSTEM_MANAGER.password);
    await this.page.locator('button[type=submit]').click();
    await this.page.getByRole('region', { name: 'Task detail content' }).waitFor();
  }
  async expectReturn() {
    assert.equal(new URL(this.page.url()).pathname + new URL(this.page.url()).search + new URL(this.page.url()).hash, this.deepPath);
    await this.page.reload();
    await this.page.getByRole('region', { name: 'Task detail content' }).filter({ hasText: 'Selected nested task' }).waitFor();
    assert.equal(new URL(this.page.url()).pathname + new URL(this.page.url()).search + new URL(this.page.url()).hash, this.deepPath);
  }
  static async builtCore() { await access(path.join(ROOT, 'apps/web/dist/index.html')); }
  static async deliveredApp() {
    // Reuse the repository's literal build-core-first/package-later proof,
    // which copies the core apart from the app and serves the built artifacts.
    await promisify(execFile)('node', ['tools/prove-runtime-packages.mjs'], { cwd: ROOT, maxBuffer: 8 * 1024 * 1024, timeout: 240_000 });
  }
}

module.exports = { AppDocument };
