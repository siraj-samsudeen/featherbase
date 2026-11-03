'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Api, signedInState } = require('../api');

// Secrets stay in this object, never in step arguments, attachments or UI.
class AccessTokens {
  constructor(api) {
    this.api = api;
    this.accounts = new Map();
  }

  static async arrange() { return new AccessTokens(await Api.asSystemManager()); }

  async createAccount(name) {
    const response = await this.api.call('POST', '/api/service_accounts', { label: name, roles: [] }, [201], 'create acceptance service account');
    const account = await response.json();
    this.accounts.set(name, account);
    this.account = this.accounts.values().next().value;
  }

  async cleanUp() {
    // Only IDs created by this scenario are touched. Retire their fixed example
    // names rather than deleting principals or anyone else's records.
    for (const account of this.accounts.values())
      await this.api.call('PATCH', `/api/service_accounts/${account.row_id}`, { label: `acceptance-${randomUUID()}` }, [200], 'retire acceptance account name');
    this.secret = undefined;
  }

  async issue(label, expiresAt) {
    const response = await this.api.call('POST', '/api/access_tokens', {
      owner: this.account.row_id, label, ...(expiresAt ? { expires_at: expiresAt } : {}),
    }, [201], 'issue acceptance token');
    return response.json();
  }

  async workingToken(label) {
    const issued = await this.issue(label);
    this.secret = issued.token;
    this.token = { ...issued };
    delete this.token.token;
    this.originalIdentity = await this.identity();
  }

  async oldTokens() {
    const revoked = await this.issue('acceptance revoked');
    await this.api.call('DELETE', `/api/access_tokens/${revoked.id}`, undefined, [200], 'revoke acceptance token');
    const expiresAt = Date.now() + 1500;
    const expired = await this.issue('acceptance expired', new Date(expiresAt).toISOString());
    // Let the actual server-issued credential expire, without clock mocks or DB writes.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 100)));
    const tokens = await this.tokens();
    assert.ok(tokens.find(t => t.id === revoked.id).revoked_at);
    assert.ok(new Date(tokens.find(t => t.id === expired.id).expires_at) < new Date());
  }

  async open(page) {
    this.page = page;
    await page.goto('/featherbase/admin/access-tokens');
    await page.getByTestId('issue-token').waitFor();
  }

  async prepareToken() {
    await this.page.getByRole('tab', { name: 'Service accounts', exact: true }).click();
    await this.page.getByTestId(`sa-issue-${this.account.row_id}`).click();
    await this.page.getByTestId('issue-dialog').waitFor();
  }

  async cancelAccountRename(name) {
    await this.page.getByRole('tab', { name: 'Service accounts', exact: true }).click();
    await this.page.getByTestId(`sa-rename-${this.account.row_id}`).click();
    await this.page.getByTestId('rename-name').fill(name);
    await this.page.getByTestId('rename-dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await this.page.getByTestId('rename-dialog').waitFor({ state: 'hidden' });
  }

  async customNameAndChangeOwner(name) {
    await this.page.getByTestId('token-label').fill(name);
    const owner = this.page.getByTestId('token-owner');
    const other = await owner.locator('option').evaluateAll((options, current) => options.find(o => o.value !== current).value, this.account.row_id);
    await owner.selectOption(other);
    assert.equal(await owner.inputValue(), other);
  }

  async expectPreparedName(name) { assert.equal(await this.page.getByTestId('token-label').inputValue(), name); }

  async accountRows() {
    return (await (await this.api.call('GET', '/api/service_accounts', undefined, [200], 'list service accounts')).json()).service_accounts;
  }

  async expectAccountNames(names) {
    const rows = await this.accountRows();
    for (const name of names) assert.equal(rows.find(a => a.row_id === this.accounts.get(name).row_id)?.label, name);
    if (this.page) {
      for (const name of names) assert.ok((await this.page.getByTestId(`sa-${this.accounts.get(name).row_id}`).innerText()).includes(name));
    }
  }

  async tokens() {
    return (await (await this.api.call('GET', '/api/access_tokens', undefined, [200], 'list access tokens')).json()).tokens;
  }

  async renameTokenToBlank() {
    this.refused = await this.api.call('PATCH', `/api/access_tokens/${this.token.id}`, { label: '   ' });
    assert.equal(this.refused.status(), 417);
  }

  async renameAsOrdinaryUser(person, name) {
    const state = await signedInState(person.email, person.password);
    const bearer = state.origins[0].localStorage.find(item => item.name === 'fc_token').value;
    const ordinary = new Api(this.api.ctx, { Authorization: `Bearer ${bearer}` });
    this.refused = await ordinary.call('PATCH', `/api/access_tokens/${this.token.id}`, { label: name });
    assert.equal(this.refused.status(), 403);
  }

  async expectRefusedTokenName(name) {
    assert.ok(this.refused && !this.refused.ok());
    const token = (await this.tokens()).find(t => t.id === this.token.id);
    assert.equal(token.label, name);
    for (const key of ['id', 'owner', 'expires_at', 'revoked_at']) assert.equal(token[key], this.token[key]);
    const identity = await this.identity();
    assert.equal(identity.row_id, this.originalIdentity.row_id);
  }

  async renameAccountAndToken(accountName, tokenName) {
    await this.api.call('PATCH', `/api/service_accounts/${this.account.row_id}`, { label: accountName }, [200], 'rename service account');
    const response = await this.api.call('PATCH', `/api/access_tokens/${this.token.id}`, { label: tokenName }, [200], 'rename token');
    this.expectNoSecret(await response.json());
  }

  async identity() {
    const credential = new Api(this.api.ctx, { Authorization: `Bearer ${this.secret}` });
    const response = await credential.call('GET', '/api/whoami');
    assert.equal(response.status(), 200, 'the original credential still authenticates');
    return response.json();
  }

  async expectSameCredential(name) {
    const identity = await this.identity();
    assert.equal(identity.row_id, this.originalIdentity.row_id);
    assert.equal(identity.row_id, this.account.row_id);
    assert.equal(identity.full_name, name);
    assert.deepEqual(identity.roles, this.originalIdentity.roles);
  }

  expectNoSecret(value) {
    assert.equal(Object.hasOwn(value, 'token'), false, 'no secret returned after issuance');
    assert.equal(Object.hasOwn(value, 'secret'), false);
    assert.equal(Object.hasOwn(value, 'token_hash'), false);
    assert.equal(JSON.stringify(value).includes(this.secret), false, 'credential must not be disclosed');
  }

  async expectListedToken(name) {
    const tokens = await this.tokens();
    this.expectNoSecret(tokens);
    const token = tokens.find(t => t.id === this.token.id);
    assert.equal(token.label, name);
    for (const key of ['id', 'owner', 'expires_at', 'revoked_at']) assert.equal(token[key], this.token[key]);
    for (const row of tokens) this.expectNoSecret(row);
  }

  async claimTakenName(from, to) {
    this.refused = await this.api.call('PATCH', `/api/service_accounts/${this.accounts.get(from).row_id}`, { label: to });
    assert.equal(this.refused.status(), 409);
  }

  async expectBothNames() {
    assert.ok(this.refused && !this.refused.ok());
    await this.expectAccountNames([...this.accounts.keys()]);
  }
}

module.exports = { AccessTokens };
