'use strict';

const { expect } = require('playwright/test');
const { rowHref, tableHref } = require('../../../packages/shared/src/app-routes.ts');

class RecordWorkspace {
  constructor(page) { this.page = page; }
  /** The Plant name field: a text box to whoever may edit the row; its value, read only, to a reader (#795). */
  plantName() { return this.page.getByTestId('form-view').getByLabel('Plant name', { exact: true }); }
  async openRow() {
    await this.page.goto(rowHref('Plant', '9154'));
    await this.page.getByTestId('form-view').waitFor();
    const name = this.plantName();
    await name.waitFor();
    if (await name.evaluate((el) => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) await expect(name).toHaveValue('Tenkasi');
    else await expect(name).toHaveText('Tenkasi');
  }
  async area(name) { await this.page.getByRole('tab', { name, exact: true }).click(); }
  async consultActivityWithEdit() {
    await this.openRow();
    await this.page.getByLabel('Plant name', { exact: true }).fill('Tenkasi distribution');
    await this.area('Activity');
    await this.page.getByTestId('activity-timeline').waitFor();
    await this.area('Form');
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
    await this.page.keyboard.press('Escape');
    await expect(actions).toBeFocused();
    await expect(this.page.getByTestId('form-print')).not.toBeVisible();
    // #910: related navigation is the row's Map and Tree tabs and its connections.
    await this.area('Map');
    await expect(this.page.getByTestId('relation-map')).toBeVisible();
    await this.area('Tree');
    await expect(this.page.getByRole('tree')).toBeVisible();
  }
  async openList() {
    await this.page.goto(tableHref('Plant'));
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
    // A reader's row shows its values read only (#795): nothing to type into.
    await expect(this.plantName()).toHaveText('Tenkasi');
    await expect(this.page.getByRole('textbox', { name: 'Plant name', exact: true })).toHaveCount(0);
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

module.exports = { RecordWorkspace };
