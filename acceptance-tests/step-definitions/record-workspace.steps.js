'use strict';

const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');
const { RecordWorkspace } = require('../support/pages/record-workspace');

async function plant(world) {
  world.table = 'Plant';
  await world.withApi(api => api.createTable({
    name: 'Plant', id_pattern: 'prompt', title_column: 'plant_name',
    columns: [{ column_name: 'plant_name', column_type: 'Data', label: 'Plant name', in_list_view: true }],
  }, [{ row_id: '9154', plant_name: 'Tenkasi' }]));
  world.workspace = new RecordWorkspace(await world.actor());
}

async function collaborate(world) {
  await plant(world);
  await world.withApi(async api => {
    await api.call('POST', '/api/assign', { table: 'Plant', row_id: '9154', assign_to: 'Administrator' }, [201], 'assign Tenkasi');
    await api.call('POST', '/api/tags', { table: 'Plant', row_id: '9154', tag: 'priority' }, [201], 'tag Tenkasi');
    await api.saveRow('Comment', { ref_table: 'Plant', ref_name: '9154', content: 'Supplier called' });
    const upload = await api.ctx.post('/api/upload_file', {
      headers: api.headers,
      multipart: { ref_table: 'Plant', ref_name: '9154', file: { name: 'plant-note.txt', mimeType: 'text/plain', buffer: Buffer.from('Plant note') } },
    });
    assert.equal(upload.status(), 201);
    const row = await api.row('Plant', '9154');
    await api.call('PATCH', '/api/table/Plant/9154', { plant_name: 'Tenkasi before review', updated_at: row.updated_at }, [200], 'record edit');
    const edited = await api.row('Plant', '9154');
    await api.call('PATCH', '/api/table/Plant/9154', { plant_name: 'Tenkasi', updated_at: edited.updated_at }, [200], 'restore reviewed name');
  });
}

Given('the user can edit the Plant row for Tenkasi', async function () { await plant(this); });
When('the user changes its name and consults its activity before returning to work', async function () { await this.workspace.consultActivityWithEdit(); });
Then('the unfinished name is still present and can be saved', async function () { await this.workspace.saveEdit(); });
Then("the row's print and related navigation remain reachable", async function () { await this.workspace.occasionalNavigation(); });
Given('the user manages the Plant Table containing Tenkasi', async function () { await plant(this); });
When('the user selects Tenkasi in its list', async function () { await this.workspace.select(); });
Then('the selection offers deletion of rows separately from deletion of the Table', async function () { await this.workspace.distinctDeletion(); });
Then('clearing the selection removes the row operations without changing Tenkasi', async function () {
  await this.workspace.clearSelection();
  assert.equal((await this.withApi(api => api.row('Plant', '9154'))).plant_name, 'Tenkasi');
});
Given('the user can only read the Plant row for Tenkasi', async function () {
  await plant(this);
  const role = await this.withApi(api => api.readerRoleFor('Plant'));
  await this.person('the user', [role]);
  this.workspace = new RecordWorkspace(await this.actor());
});
When('the user consults its list views and related navigation', async function () { await this.workspace.consultListNavigation(); });
Then('the list does not offer Table administration', async function () { await this.workspace.noAdministration(); });
Then('Tenkasi remains readable', async function () { await this.workspace.openRow(); });
Given('the user reads Tenkasi with collaboration enabled but no collaboration grants', async function () {
  await plant(this);
  const role = await this.withApi(async api => {
    for (const property of ['enable_assignments', 'enable_tags', 'enable_files', 'enable_discussion'])
      await api.saveRow('Metadata Override', { table_name: 'Plant', property, value: 'true' });
    return api.readerRoleFor('Plant');
  });
  await this.person('the user', [role]);
  this.workspace = new RecordWorkspace(await this.actor());
});
When("the user consults Tenkasi's available operations", async function () { await this.workspace.openRow(); });
Then('Tenkasi is read-only without save, rename or delete operations', async function () { await this.workspace.readOnlyOperations(); });
Then('assigning, uploading and composing discussion are absent', async function () { await this.workspace.noUnavailableCollaboration(); });
Then('the reader can still label Tenkasi with a tag', async function () { await this.workspace.tagPlant(); });
Then('selecting Tenkasi offers no unavailable bulk mutations', async function () { await this.workspace.noBulkMutations(); });
Given('Tenkasi has an assignment, a tag, a file and a discussion', async function () { await collaborate(this); });
When('the user opens Tenkasi with collaboration disabled', async function () { await this.workspace.openRow(); });
Then('the existing collaboration is readable without collaboration mutation controls', async function () { await this.workspace.retainedCollaboration(); });
Then('the user can still consult its audit history', async function () { await this.workspace.audit(); });
Given('the Plant Table explicitly enables tags alone', async function () {
  await plant(this);
  await this.withApi(api => api.saveRow('Metadata Override', { table_name: 'Plant', property: 'enable_tags', value: 'true' }));
});
When('the user labels Tenkasi with a tag', async function () { await this.workspace.tagPlant(); });
Then('the tag is saved and the other empty collaboration features stay absent', async function () { await this.workspace.onlyTags(); });
Given('Tenkasi has a discussion and a recorded edit', async function () { await collaborate(this); });
When('the user consults its activity', async function () { await this.workspace.openRow(); await this.workspace.area('Activity'); });
Then('the discussion and edit appear together once', async function () { await this.workspace.singleDiscussion(); });
