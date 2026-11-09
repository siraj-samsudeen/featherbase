'use strict';

// Attaching a file to a row you may change (files-and-sharing): someone who may
// change a row attaches a photo to it without any access to files in general;
// someone who may only read it is refused, and nothing is stored.

const assert = require('node:assert/strict');
const { request } = require('playwright');
const { Given, When, Then, After } = require('@cucumber/cucumber');
const { API_URL } = require('../support/stack');
const { PERSON_PASSWORD } = require('../support/world');

const TABLE = 'Attach Order';
const PHOTO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

/** A role with exactly these operations on the orders table, and nothing on File. */
async function role(api, name, operations) {
  const have = await api.call('GET', `/api/table/Role/${encodeURIComponent(name)}`);
  if (have.status() !== 200) await api.call('POST', '/api/save_row', { table: 'Role', row: { row_id: name } }, [201], `create role ${name}`);
  await api.grant(TABLE, name, operations);
  return name;
}

/** The orders table with one order, and the user with this access to it. */
async function orderFor(world, orderId, operations) {
  await world.withApi(async (api) => {
    await api.createTable({
      name: TABLE, id_pattern: 'prompt', title_column: 'customer',
      columns: [{ column_name: 'customer', column_type: 'Data', label: 'Customer', in_list_view: true }],
    }, [{ row_id: orderId, customer: 'Kumar Stores' }]);
    const roleName = await role(api, `${TABLE} ${operations.join(' ')}`, operations);
    const person = await world.person('the user', [roleName]);
    // The person's own API session, as the browser's upload uses.
    const ctx = await request.newContext({ baseURL: API_URL });
    const login = await ctx.post('/api/login', { data: { usr: person.email, pwd: PERSON_PASSWORD } });
    assert.ok(login.ok(), `sign-in as the user: ${login.status()}`);
    const { token } = await login.json();
    world.attach = { orderId, ctx, headers: { Authorization: `Bearer ${token}` } };
  });
  const filesAccess = await world.attach.ctx.get(`/api/table/File`, { headers: world.attach.headers });
  assert.equal(filesAccess.status(), 403, 'the user has no access to files in general');
}

async function filesOn(world) {
  const filters = encodeURIComponent(JSON.stringify([['ref_table', '=', TABLE], ['ref_name', '=', world.attach.orderId]]));
  return world.withApi(async (api) => {
    const res = await api.call('GET', `/api/table/File?filters=${filters}&fields=${encodeURIComponent(JSON.stringify(['row_id', 'file_url', 'ref_name']))}`, undefined, [200], 'files on the order');
    return (await res.json()).data;
  });
}

async function attachPhoto(world) {
  const { ctx, headers, orderId } = world.attach;
  world.attach.response = await ctx.post('/api/upload_file', {
    headers,
    multipart: { ref_table: TABLE, ref_name: orderId, is_private: '1', file: { name: 'counter.png', mimeType: 'image/png', buffer: PHOTO } },
  });
}

After(async function () { await this.attach?.ctx?.dispose(); });

Given('the user may change the order {string} but has no access to files in general', async function (orderId) {
  await orderFor(this, orderId, ['read', 'update']);
});

Given('the user may read the order {string} but not change it, and has no access to files in general', async function (orderId) {
  await orderFor(this, orderId, ['read']);
  const { ctx, headers } = this.attach;
  const row = await (await ctx.get(`/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(orderId)}`, { headers })).json();
  const change = await ctx.patch(`/api/table/${encodeURIComponent(TABLE)}/${encodeURIComponent(orderId)}`, { headers, data: { customer: 'Changed', updated_at: row.updated_at } });
  assert.equal(change.status(), 403, 'the user cannot change the order');
});

When('the user attaches a photo to the order', async function () { await attachPhoto(this); });
When('the user tries to attach a photo to the order', async function () { await attachPhoto(this); });

Then('the photo is attached to the order and the user can open it', async function () {
  const { response, ctx, headers } = this.attach;
  assert.equal(response.status(), 201, await response.text());
  const files = await filesOn(this);
  assert.equal(files.length, 1, 'one file on the order');
  const opened = await ctx.get(files[0].file_url, { headers });
  assert.equal(opened.status(), 200, `opening ${files[0].file_url}`);
  assert.deepEqual(Buffer.from(await opened.body()), PHOTO);
});

Then('the upload is refused and nothing is stored', async function () {
  const { response } = this.attach;
  assert.equal(response.status(), 403, await response.text());
  assert.deepEqual(await filesOn(this), [], 'no file on the order');
});
