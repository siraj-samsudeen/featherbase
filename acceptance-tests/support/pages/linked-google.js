'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// #837: a person's claimed Google invite, read on their Person form.
const ACCOUNT_NUMBER = '104116711844961612173';

class LinkedGoogle {
  constructor(page) { this.page = page; }

  /** A person invited by a Google address; the Google method is turned on. */
  static async invitedPerson(api) {
    const ids = await api.rowIds('Sign In Method', 20);
    let google = null;
    for (const id of ids) {
      const row = await api.row('Sign In Method', id);
      if (row.kind === 'google') google = row;
    }
    if (!google) throw new Error('The platform must provide the Google sign-in method');
    if (!google.enabled) await api.call('POST', '/api/save_row', { table: 'Sign In Method', row: { ...google, enabled: true } }, [200, 201], 'turn Google on');
    const address = `linked.google.${randomUUID().slice(0, 8)}@gmail.com`;
    const made = await api.call('POST', '/api/save_row', { table: 'Person', row: { full_name: 'Linked Google', enabled: true } }, [201], 'create a person');
    const person = (await made.json()).row_id;
    await api.call('POST', `/api/people/${encodeURIComponent(person)}/identities`, { method: google.row_id, email: address, send_invitation_email: false }, [200, 201], 'invite the Google address');
    return { person, address };
  }

  /** Signs in through the mock Google consent screen as that address. */
  static async signInWithGoogle(page, address) {
    await page.goto('/login');
    await page.getByTestId('google-login').first().click();
    await page.getByTestId('mock-email').fill(address);
    await page.getByTestId('mock-subject').fill(ACCOUNT_NUMBER);
    await page.getByTestId('mock-approve').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/api/oauth') && !url.pathname.startsWith('/login'));
  }

  async open(person) {
    await this.page.goto(`/featherbase/admin/Person/${encodeURIComponent(person)}`);
    this.panel = this.page.getByTestId('user-sign-in-methods');
    this.row = this.panel.locator('li', { hasText: 'Google' }).first();
    await this.row.waitFor();
  }

  async leadsWith(address) {
    const head = (await this.row.getByTestId('identity-head').textContent()).trim();
    assert.equal(head, `Google · ${address}`);
  }

  async linkedAtFirstSignIn() {
    const linked = await this.row.getByTestId('identity-linked').textContent();
    assert.match(linked, /^linked \d{2}-[A-Z][a-z]{2}-\d{4} .* at first sign-in · last signed in \d{2}-[A-Z][a-z]{2}-\d{4} /);
  }

  async accountNumberOnlyInDetails() {
    assert.equal(await this.row.getByText(ACCOUNT_NUMBER).isVisible(), false, 'the account number shows before asking');
    await this.row.getByText('Details').click();
    await this.row.getByText(`Google account number: ${ACCOUNT_NUMBER}`).waitFor();
  }
}

module.exports = { LinkedGoogle };
