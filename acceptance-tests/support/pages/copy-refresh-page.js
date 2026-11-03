'use strict';

class CopyRefreshPage {
  constructor(page) { this.page = page; }

  async open(readOnly = false) {
    await this.page.goto('/featherbase/admin/Plants');
    await this.page.getByTestId('list-view').waitFor();
    if (readOnly) return;
    await this.page.waitForFunction(() => {
      const select = document.querySelector('[aria-label="Refresh automatically"]');
      return select && !select.disabled;
    });
  }

  async schedule(cadence) {
    const control = this.page.getByRole('combobox', { name: 'Refresh automatically' });
    await control.selectOption(cadence);
    await this.page.waitForFunction(() => !document.querySelector('[aria-label="Refresh automatically"]').disabled);
    await this.page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  }

  async pause() {
    await this.page.getByRole('button', { name: 'Pause', exact: true }).click();
    await this.page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  }

  async cadence() {
    return this.page.getByRole('combobox', { name: 'Refresh automatically' }).inputValue();
  }

  async tryScheduling() {
    return this.page.evaluate(async () => {
      const response = await fetch('/api/table/Plants:set_copy_schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence: 'hourly', enabled: true }),
      });
      return response.status;
    });
  }
}

module.exports = { CopyRefreshPage };
