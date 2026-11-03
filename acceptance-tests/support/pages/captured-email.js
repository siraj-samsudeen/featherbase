'use strict';

const assert = require('node:assert/strict');
const { expect } = require('playwright/test');
const { acceptanceSql } = require('../stack');
const { Api } = require('../api');

const NORMAL_BODY = 'Hello Priya,\n\nYour invoice is ready.\nThank you,\nAccounts';
const UNSAFE_BODY = '<img src="https://email-tracker.invalid/pixel" onerror="window.emailExecuted=true">\n<script>window.emailExecuted=true</script>\n' + 'long-line-'.repeat(180);

class CapturedEmail {
  constructor(page) { this.page = page; this.remote = []; }

  async seed(variant = 'normal') {
    this.body = variant === 'empty' ? '' : variant === 'unsafe' ? UNSAFE_BODY : NORMAL_BODY;
    this.names = variant === 'empty' ? null : 'invoice.pdf, terms.txt';
    this.id = `invoice-${variant}`;
    await acceptanceSql(`insert into featherbase.email_sink
      (row_id, created_by, updated_by, mail_from, mail_to, subject, body, attachment_names, attachment_b64)
      values ($1, 'Administrator', 'Administrator', 'accounts@example.test', 'priya@example.test',
      'Your November invoice', $2, $3, $4)
      on conflict (row_id) do update set body = excluded.body, attachment_names = excluded.attachment_names`,
    [this.id, this.body, this.names, this.names ? 'aW52b2ljZQ==' : null]);
    this.page.on('request', request => {
      if (request.url().includes('email-tracker.invalid')) this.remote.push(request.url());
    });
  }

  async open() {
    await this.page.goto(`/featherbase/admin/Email%20Sink/${this.id}`);
    await this.page.getByTestId('reading-presentation').waitFor();
  }

  async expectEmail() {
    const reading = this.page.getByTestId('reading-presentation');
    await expect(reading.getByRole('heading', { name: 'Your November invoice' })).toBeVisible();
    for (const text of ['accounts@example.test', 'priya@example.test', this.names])
      await expect(reading.getByText(text, { exact: true })).toBeVisible();
    await expect(reading.getByTestId('reading-body')).toHaveText(this.body);
    await expect(reading.getByTestId('reading-header-created_at')).not.toHaveText('');
    assert.equal(await reading.getByRole('link').count(), 0);
  }

  async expectNotice() {
    await expect(this.page.getByTestId('reading-presentation')).toContainText('Captured locally in Email Sink. This does not confirm external delivery.');
  }

  async expectRaw() {
    const details = this.page.getByTestId('raw-details');
    assert.equal(await details.evaluate(el => el.open), false);
    await this.page.mouse.move(280, 180);
    await details.getByText('Raw details', { exact: true }).hover();
    await details.getByText('Raw details', { exact: true }).click();
    await expect(details.locator('[data-field="body"]')).toBeDisabled();
    await expect(details.locator('[data-field="attachment_b64"]')).toBeDisabled();
    for (const id of ['form-save', 'form-delete', 'form-rename'])
      assert.equal(await this.page.getByTestId(id).count(), 0);
  }

  async expectEmpty() {
    await expect(this.page.getByTestId('reading-presentation')).toContainText('No message body');
    await expect(this.page.getByTestId('reading-presentation')).toContainText('No attachments');
  }

  async expectInert() {
    const reading = this.page.getByTestId('reading-presentation');
    await expect(reading.getByTestId('reading-body')).toHaveText(this.body);
    assert.equal(await reading.locator('img,script,iframe,object,embed,link,style').count(), 0);
    assert.equal(await this.page.evaluate(() => window.emailExecuted), undefined);
    assert.deepEqual(this.remote, []);
  }

  async expectWrapped() {
    const result = await this.page.getByTestId('reading-body').evaluate(el => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      fits: el.scrollWidth <= el.clientWidth,
    }));
    assert.equal(result.whiteSpace, 'pre-wrap');
    assert.equal(result.fits, true);
  }

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
  }

  async openReference() {
    await this.page.goto('/featherbase/admin/Reference%20Notice/notice');
  }

  async expectReference() {
    const reading = this.page.getByTestId('reading-presentation');
    await expect(reading).toContainText('Reference title');
    await expect(reading).toContainText('Reference body');
    await expect(reading).not.toContainText('Email Sink');
  }

  async expectEditable() {
    await this.page.goto('/featherbase/admin/Writable%20Notice/notice');
    await expect(this.page.locator('[data-field="message"]')).toBeEnabled();
    assert.equal(await this.page.getByTestId('reading-presentation').count(), 0);
    await expect(this.page.getByTestId('form-save')).toBeVisible();
  }
}

module.exports = { CapturedEmail };
