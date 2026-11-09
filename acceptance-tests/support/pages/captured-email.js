'use strict';

const assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { rowHref } = require('../../../packages/shared/src/app-routes.ts');
const { acceptanceSql, restartAcceptance } = require('../stack');
const { Api } = require('../api');

class CapturedEmail {
  constructor(page) { this.page = page; }

  async seedReference() {
    const api = await Api.asSystemManager();
    await api.createTable({ name: 'Reference Notice', reading_presentation: {
      title: 'title', headers: ['count'], body: 'message',
    }, columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'count', column_type: 'Int' },
      { column_name: 'message', column_type: 'Text' },
    ] }, [{ row_id: 'notice', title: 'Reference title', count: 7, message: 'Reference body' }]);
    await acceptanceSql("update featherbase.table_def set system_written = true where name = 'Reference Notice'");
    // Refresh effective metadata after configuring this test-only read-only Table.
    await api.createTable({ name: 'Writable Notice', reading_presentation: {
      title: 'title', headers: [], body: 'message',
    }, columns: [
      { column_name: 'title', column_type: 'Data' },
      { column_name: 'message', column_type: 'Text' },
    ] }, [{ row_id: 'notice', title: 'Editable title', message: 'Editable body' }]);
    await restartAcceptance();
  }

  async openReference() {
    await this.page.goto(rowHref('Reference Notice', 'notice'));
  }

  async expectReference() {
    const reading = this.page.getByTestId('reading-presentation');
    await expect(reading).toContainText('Reference title');
    await expect(reading).toContainText('Reference body');
    await expect(reading).not.toContainText('Email Sink');
  }

  async expectEditable() {
    await this.page.goto(rowHref('Writable Notice', 'notice'));
    await expect(this.page.locator('[data-field="message"]')).toBeEnabled();
    assert.equal(await this.page.getByTestId('reading-presentation').count(), 0);
    await expect(this.page.getByTestId('form-save')).toBeVisible();
  }
}

module.exports = { CapturedEmail };
