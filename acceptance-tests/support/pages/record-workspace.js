'use strict';

const { expect } = require('playwright/test');

class RecordWorkspace {
  constructor(page) { this.page = page; }
  async openRow() {
    await this.page.goto('/featherbase/admin/Plant/9154');
    await this.page.getByTestId('form-view').waitFor();
    await expect(this.page.getByLabel('Plant name', { exact: true })).toHaveValue('Tenkasi');
  }
  async area(name) { await this.page.getByRole('tab', { name, exact: true }).click(); }
  async consultActivityWithEdit() {
    await this.openRow();
    await this.page.getByLabel('Plant name', { exact: true }).fill('Tenkasi distribution');
    await this.area('Activity');
    await this.page.getByTestId('activity-timeline').waitFor();
    await this.area('Work');
  }
  async saveEdit() {
    await expect(this.page.getByLabel('Plant name', { exact: true })).toHaveValue('Tenkasi distribution');
    await this.page.getByTestId('form-save').click();
    await expect(this.page.getByTestId('form-banner')).toHaveText('Saved');
  }
  async occasionalNavigation() {
    const actions = this.page.getByRole('button', { name: 'Record actions', exact: true });
    await actions.focus();
    await this.page.keyboard.press('Enter');
    await expect(this.page.getByTestId('form-print')).toBeVisible();
    await expect(this.page.getByTestId('form-map')).toBeVisible();
    await this.page.keyboard.press('Escape');
    await expect(actions).toBeFocused();
    await expect(this.page.getByTestId('form-print')).not.toBeVisible();
    await this.area('Related');
  }
  async openList() {
    await this.page.goto('/featherbase/admin/Plant');
    await this.page.getByRole('checkbox', { name: 'Select Tenkasi', exact: true }).waitFor();
  }
  async select() {
    await this.openList();
    await expect(this.page.getByTestId('bulk-bar')).not.toBeVisible();
    await this.page.getByRole('checkbox', { name: 'Select Tenkasi', exact: true }).check();
  }
  async distinctDeletion() {
    await expect(this.page.getByTestId('bulk-delete')).toHaveText('Delete rows');
    await expect(this.page.getByTestId('delete-table')).not.toBeVisible();
    await this.page.getByRole('button', { name: 'Table administration', exact: true }).click();
    await expect(this.page.getByTestId('delete-table')).toHaveText('Delete Table');
    await this.page.keyboard.press('Escape');
  }
  async clearSelection() {
    await this.page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    await expect(this.page.getByTestId('bulk-bar')).not.toBeVisible();
    await expect(this.page.getByRole('checkbox', { name: 'Select Tenkasi', exact: true })).not.toBeChecked();
  }
  async consultListNavigation() {
    await this.openList();
    await this.page.getByRole('button', { name: 'View: List', exact: true }).click();
    await expect(this.page.getByTestId('open-report')).toBeVisible();
    await this.page.keyboard.press('Escape');
    await expect(this.page.getByTestId('open-explore')).toBeVisible();
  }
  async noAdministration() {
    await expect(this.page.getByRole('button', { name: 'Table administration', exact: true })).toHaveCount(0);
    await expect(this.page.getByTestId('open-columns')).toHaveCount(0);
  }
  async readOnlyOperations() {
    await expect(this.page.getByLabel('Plant name', { exact: true })).toBeDisabled();
    await expect(this.page.getByTestId('form-save')).toHaveCount(0);
    await this.page.getByRole('button', { name: 'Record actions', exact: true }).click();
    for (const id of ['form-rename', 'form-delete'])
      await expect(this.page.getByTestId(id)).toHaveCount(0);
    await this.page.keyboard.press('Escape');
  }
  async noUnavailableCollaboration() {
    await this.area('Collaboration');
    for (const id of ['assign-to', 'attach-file', 'attachment-delete'])
      await expect(this.page.getByTestId(id)).toHaveCount(0);
    await this.area('Activity');
    await expect(this.page.getByTestId('comment-input')).toHaveCount(0);
  }
  async noBulkMutations() {
    await this.openList();
    await this.page.getByRole('checkbox', { name: 'Select Tenkasi', exact: true }).check();
    for (const id of ['bulk-delete', 'bulk-edit-field'])
      await expect(this.page.getByTestId(id)).toHaveCount(0);
    await this.page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  }
  async retainedCollaboration() {
    await this.area('Collaboration');
    await expect(this.page.getByTestId('assignments-panel')).toContainText('Administrator');
    await expect(this.page.getByTestId('tags-panel')).toContainText('priority');
    await expect(this.page.getByTestId('attachments-panel')).toContainText('plant-note.txt');
    for (const id of ['assign-submit', 'tag-add', 'attach-file', 'attachment-delete'])
      await expect(this.page.getByTestId(id)).toHaveCount(0);
    await this.area('Activity');
    await expect(this.page.getByTestId('activity-timeline')).toContainText('Supplier called');
    await expect(this.page.getByTestId('comment-input')).toHaveCount(0);
  }
  async audit() {
    await this.area('Activity');
    await expect(this.page.getByTestId('activity-timeline')).toContainText('Tenkasi');
  }
  async tagPlant() {
    await this.openRow();
    await this.area('Collaboration');
    await this.page.getByTestId('tag-input').fill('priority');
    await this.page.getByTestId('tag-add').click();
    await expect(this.page.getByTestId('tag-chip')).toContainText('priority');
    await expect(this.page.getByRole('button', { name: 'Remove priority', exact: true })).toBeVisible();
  }
  async onlyTags() {
    for (const id of ['assignments-panel', 'attachments-panel'])
      await expect(this.page.getByTestId(id)).toHaveCount(0);
    await this.area('Activity');
    await expect(this.page.getByTestId('comment-input')).toHaveCount(0);
  }
  async singleDiscussion() {
    await expect(this.page.getByTestId('activity-comment')).toHaveCount(1);
    await expect(this.page.getByTestId('activity-version').first()).toBeVisible();
    await expect(this.page.getByTestId('comment-content')).toHaveCount(1);
    await expect(this.page.getByTestId('comment-list')).toHaveCount(0);
  }
}

class RelatedWorkspace extends RecordWorkspace {
  async openRow() {
    await this.page.goto('/featherbase/admin/Lab%20Project/lab-north');
    await expect(this.page.getByLabel('Region', { exact: true })).toHaveValue('North');
  }
  selector() { return this.page.getByRole('navigation', { name: 'Relationships', exact: true }); }
  rows() { return this.page.getByRole('region', { name: 'Related rows', exact: true }); }
  async selectPath(column) {
    await this.openRow();
    await this.area('Related');
    await this.selector().getByRole('button', { name: new RegExp(`Lab Task · ${column} `) }).click();
  }
  async emptyPath() {
    await expect(this.rows().getByTestId('list-total')).toHaveText('0 total');
    await expect(this.rows()).toContainText('No rows');
  }
  async distinctPaths() {
    await expect(this.selector()).toHaveCount(1);
    await expect(this.selector().getByRole('button', { name: 'Lab Task · project 2', exact: true })).toBeVisible();
    await expect(this.selector().getByRole('button', { name: 'Lab Task · review_project 0', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(this.page.getByTestId('connections-panel')).toHaveCount(0);
    await expect(this.page.getByTestId('related-tabs')).toHaveCount(0);
  }
  async searchRelationships(query) { await this.page.getByRole('searchbox', { name: 'Search relationships', exact: true }).fill(query); }
  async oneRelationship() {
    await expect(this.selector().getByRole('button')).toHaveCount(1);
    await expect(this.page.getByRole('region', { name: 'Search relationships', exact: true })).toContainText('1 of 2');
  }
  async searchRecords(query) { await this.rows().getByRole('searchbox', { name: 'Search related record names', exact: true }).fill(query); }
  async matchingRecord() {
    await expect(this.rows().getByTestId('list-total')).toHaveText('1 total');
    await expect(this.rows().getByTestId('list-rows')).toContainText('Review materials');
    await expect(this.rows()).not.toContainText('Review budget');
  }
  async clearRecordSearch() {
    await this.searchRecords('');
    await expect(this.rows().getByTestId('list-total')).toHaveText('2 total');
    await expect(this.rows().getByTestId('list-rows')).toContainText('Prepare workshop');
    await expect(this.rows()).not.toContainText('Review budget');
  }
  async consultRelatedWithEdit() {
    await this.openRow();
    await this.page.getByLabel('Region', { exact: true }).fill('Unfinished North');
    await this.area('Related');
    await this.selector().getByRole('button', { name: 'Lab Task · review_project 0', exact: true }).click();
    await this.area('Work');
  }
  async retainedEdit() {
    await expect(this.page.getByLabel('Region', { exact: true })).toHaveValue('Unfinished North');
    await expect(this.page.getByTestId('form-status')).toHaveText('Not saved');
  }
  async context() {
    const crumbs = this.rows().getByRole('navigation', { name: 'Related breadcrumb', exact: true });
    await expect(crumbs).toContainText('North workshop');
    await expect(crumbs).toContainText('Related');
    await expect(crumbs).toContainText('Lab Task · project');
    await expect(this.rows().getByRole('link', { name: 'Home', exact: true })).toHaveCount(0);
  }
  async scopedNavigation() {
    const full = this.rows().getByRole('link', { name: 'Open full list', exact: true });
    const url = new URL(await full.getAttribute('href'), this.page.url());
    let filters = JSON.parse(url.searchParams.get('filters'));
    if (typeof filters === 'string') filters = JSON.parse(filters);
    require('node:assert/strict').deepEqual(filters, [['project', '=', 'lab-north']]);
    await this.rows().getByRole('button', { name: 'Peek', exact: true }).click();
    const peek = this.page.getByTestId('peek-panel-0');
    await expect(peek).toContainText('Prepare workshop');
    await expect(peek).toContainText('Review materials');
    await expect(peek).not.toContainText('Review budget');
    await this.page.keyboard.press('Escape');
  }
  async prefilledNew() {
    await this.rows().getByTestId('list-new').click();
    await expect(this.page.getByTestId('form-view')).toBeVisible();
    // Generic Reference controls currently display the row identifier, not a
    // promised title-first picker (#793 remains separately owned).
    await expect(this.page.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue('lab-north');
  }
  async onlyReadableRow() {
    await expect(this.rows().getByTestId('list-total')).toHaveText('1 total');
    await expect(this.rows().getByTestId('list-rows')).toContainText('Prepare workshop');
    await expect(this.rows()).not.toContainText('Review materials');
    await expect(this.selector().getByRole('button', { name: 'Lab Task · project 1', exact: true })).toBeVisible();
  }
  async noCreation() {
    await expect(this.rows().getByTestId('list-new')).toHaveCount(0);
    await expect(this.rows().getByTestId('list-empty-new')).toHaveCount(0);
  }
}

module.exports = { RecordWorkspace, RelatedWorkspace };
