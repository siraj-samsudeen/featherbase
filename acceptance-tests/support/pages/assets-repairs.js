'use strict';

// Repair jobs and the register as people see them in the Assets app. Builds on the shared
// Assets flow (support/pages/assets.js); steps never see a selector, a route or a table name.

const { BASE_URL } = require('./assets');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR = 3_600_000;

/** An instant as Assets writes it: "07-Nov-2026 10:00 IST" (fmtInstantIST in packages/shared). */
function istLabel(value) {
  const ist = new Date(new Date(value).getTime() + 5.5 * HOUR);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(ist.getUTCDate())}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())} IST`;
}

class Repairs {
  constructor(flow) {
    this.flow = flow;
  }

  // ---- The register ----

  /** The asset page of `assetId`, opened by a person; with `at`, their device's clock reads that instant. */
  async openAsset(name, assetId, at) {
    if (at) await this.setClock(name, at);
    return this.flow.pageText(name, `asset=${encodeURIComponent(assetId)}`);
  }

  async setClock(name, at) {
    const page = await this.flow.page(name);
    await page.clock.setFixedTime(new Date(at));
  }

  /** The "From SAP" section of the open asset page: its text and how many controls it offers. */
  async sapSection(name) {
    const page = await this.flow.page(name);
    const section = page.getByRole('region', { name: 'From SAP' });
    return {
      text: await section.innerText(),
      controls: await section.locator('input, select, textarea, button, a, [contenteditable="true"]').count(),
    };
  }

  /** The Ownership section's legal owner and operator lines, on the open asset page. */
  async ownership(name) {
    const page = await this.flow.page(name);
    const section = page.getByRole('region', { name: 'Ownership' });
    const value = async label => (await section.locator('div', { has: page.locator('dt', { hasText: label }) }).locator('dd').innerText()).trim();
    return { owner: await value('Legal owner'), operator: await value('Operator') };
  }

  /** The four states the open asset page lists. */
  async states(name) {
    const page = await this.flow.page(name);
    return (await page.getByRole('list', { name: 'States' }).innerText()).split('\n').map(line => line.trim()).filter(Boolean);
  }

  /** The register's row for one asset, after picking a site in the Place filter: its text and Tag cell, or null. */
  async registerRow(name, assetId, site, at) {
    if (at) await this.setClock(name, at);
    const page = await this.flow.page(name);
    await this.flow.pageText(name, 'assets');
    // By the scenario's own place: other scenarios may have made a site with the same name.
    if (site) await page.getByRole('combobox', { name: 'Place' }).selectOption(await this.flow.place(site));
    const table = page.getByRole('table', { name: 'Assets' });
    await table.waitFor();
    const row = table.locator('tbody tr', { has: page.locator(`a[href="#asset=${encodeURIComponent(assetId)}"]`) });
    if (!(await row.count())) return null;
    const tagColumn = await table.locator('thead th').allInnerTexts().then(heads => heads.indexOf('Tag'));
    return { text: await row.innerText(), tag: tagColumn < 0 ? null : (await row.locator('td').nth(tagColumn).innerText()).trim() };
  }

  // ---- Repair jobs ----

  /** A person reports a fault on the asset page they have open, as the form asks. */
  async reportOnPage(name, problem, priority) {
    const page = await this.flow.page(name);
    const form = page.getByRole('region', { name: 'Report a fault' });
    await form.getByLabel('What’s wrong?').fill(problem);
    await form.getByRole('radio', { name: priority }).check();
    await form.getByRole('button', { name: 'Send report' }).click();
    await form.getByRole('status').filter({ hasText: 'Report sent' }).waitFor();
  }

  /** The open asset page's "Open jobs" list, as text. */
  async openJobs(name) {
    const page = await this.flow.page(name);
    const section = page.getByRole('region', { name: 'Open jobs' });
    await section.locator('li, p').first().waitFor();
    return section.innerText();
  }

  /** The open asset page's "Past jobs" list, as text. */
  async pastJobs(name) {
    const page = await this.flow.page(name);
    const section = page.getByRole('region', { name: 'Past jobs' });
    await section.locator('li, p').first().waitFor();
    return section.innerText();
  }

  /** The person presses "Confirm it works" on the open asset page's fixed job. */
  async confirmOnPage(name, problem) {
    const page = await this.flow.page(name);
    const item = page.getByRole('region', { name: 'Waiting for you to confirm' }).getByRole('article', { name: problem });
    await item.getByRole('button', { name: 'Confirm it works' }).click();
    await page.getByRole('region', { name: 'Past jobs' }).getByText(/Closed · confirmed/).waitFor();
  }

  /** The jobs board's card for the job on `assetId`: the column it sits in and its text. */
  async boardCard(name, assetId, at) {
    if (at) await this.setClock(name, at);
    const page = await this.flow.page(name);
    await this.flow.pageText(name, 'jobs');
    // Empty columns, and Closed and Cancelled, start folded to a strip: open them all to find the card.
    const strips = page.getByRole('button', { name: /^Show .+, \d+ jobs?$/ });
    for (let left = await strips.count(); left > 0; left -= 1) {
      await strips.first().click();
      await strips.nth(left - 1).waitFor({ state: 'detached' }); // that strip is now a column
    }
    const link = page.locator(`a[href="#asset=${encodeURIComponent(assetId)}"]`);
    const card = page.locator('article.job-card', { has: link });
    await card.first().waitFor();
    const column = await card.first().evaluate(node => node.closest('section[aria-label]')?.getAttribute('aria-label'));
    return { column, text: await card.first().innerText() };
  }

  /** A person reports a fault over the API: the new job as stored. */
  report(name, assetId, problem, values = {}) {
    return this.flow.save(name, 'equipment.job', { asset: assetId, problem, ...values });
  }

  /** A person changes a job; with attempt, a refusal is kept for checking. */
  changeJob(name, jobId, values, attempt = false) {
    return this.flow.change(name, 'equipment.job', jobId, values, attempt);
  }

  /** A person confirms a fixed job works again; with attempt, a refusal is kept for checking. */
  confirm(name, jobId, attempt = false) {
    return this.flow.save(name, 'equipment.restoration', { job: jobId }, attempt);
  }

  job(jobId) {
    return this.flow.get('equipment.job', jobId);
  }

  jobsOn(assetId) {
    return this.flow.list('equipment.job', [['asset', '=', assetId]], ['row_id', 'problem', 'priority', 'job_state', 'place']);
  }

  /** A person changes an asset in the register; with attempt, a refusal is kept for checking. */
  changeAsset(name, assetId, values, attempt = false) {
    return this.flow.change(name, 'equipment.asset', assetId, values, attempt);
  }

  addAsset(name, values) {
    return this.flow.save(name, 'equipment.asset', values);
  }

  asset(assetId) {
    return this.flow.get('equipment.asset', assetId);
  }

  /** Confirmations of a job, as stored. */
  confirmations(jobId) {
    return this.flow.list('equipment.restoration', [['job', '=', jobId]], ['row_id', 'job', 'created_by', 'created_at']);
  }
}

module.exports = { Repairs, istLabel, HOUR, BASE_URL };
