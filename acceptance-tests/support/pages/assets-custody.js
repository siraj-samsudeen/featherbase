'use strict';

// Custody, clearances and transfers in the Assets app, driven as named people. Built on the
// shared Assets flow (./assets.js); steps ask this module and never see a URL or a selector.

const PC = 'Billing PC, till 3';
const HOUR = 3_600_000;

class Custody {
  constructor(flow) {
    this.flow = flow;
    this.custody = null; // the current custody row_id
    this.transfer = null; // the current transfer row_id
    this.lines = {}; // asset name -> transfer line row_id
    this.clearance = null;
  }

  // ---- Calls as a person ----

  save(person, table, row, attempt = false) {
    return this.flow.save(person, table, row, attempt);
  }

  change(person, table, id, values, attempt = false) {
    return this.flow.change(person, table, id, values, attempt);
  }

  act(person, action, payload, attempt = false) {
    return this.flow.act(person, action, payload, attempt);
  }

  // ---- Custody ----

  async issue(assetName, person, by = 'a manager') {
    const flow = this.flow;
    const asset = await flow.asset(assetName);
    const custody = await this.act(by, 'issue_custody', { asset, person: await flow.who(person), kind: 'Employee' });
    this.custody = custody.row_id;
    return custody;
  }

  async custodyRow() {
    return this.flow.get('equipment.custody', this.custody);
  }

  /** The custodian answers over HTTP; `attempt` keeps a refusal in flow.last. */
  async answer(person, state, attempt = false) {
    return this.change(person, 'equipment.custody', this.custody, { custody_state: state }, attempt);
  }

  /** The custodian presses a button on their own asset under "Your assets". */
  async pressOnMine(person, assetName, button, expectedState) {
    const flow = this.flow;
    const page = await flow.page(person);
    await flow.pageText(person, 'custody');
    const item = page.getByRole('region', { name: 'Your assets' }).getByRole('listitem', { name: assetName });
    await item.getByRole('button', { name: button }).click();
    await item.getByText(expectedState, { exact: true }).waitFor();
  }

  /** A manager presses the take-back button on the asset's row in "Who holds what". */
  async takeBack(manager, assetName, button) {
    const flow = this.flow;
    const page = await flow.page(manager);
    await flow.pageText(manager, 'custody');
    const id = flow.assets[assetName];
    const row = page.getByRole('table', { name: 'Custody' }).getByRole('row').filter({ has: page.locator(`a[href="#asset=${encodeURIComponent(id)}"]`) });
    await row.getByRole('button', { name: button }).click();
    await row.waitFor({ state: 'detached' });
  }

  // ---- Clearances ----

  async openClearance(person, leavingDate, by = 'a manager') {
    const row = await this.save(by, 'equipment.clearance', { person: await this.flow.who(person), reason: 'Leaving', leaving_date: leavingDate });
    this.clearance = row.row_id;
    return row;
  }

  async closeClearance(by, attempt = false) {
    return this.change(by, 'equipment.clearance', this.clearance, { clearance_state: 'Cleared' }, attempt);
  }

  /**
   * The status shown on each clearance row for people with this name and leaving day, read on the
   * Custody page as it looks on `day` (the browser's calendar, YYYY-MM-DD).
   */
  async clearanceStatuses(viewer, personName, leavingDay, day) {
    const flow = this.flow;
    const page = await flow.page(viewer);
    await page.clock.setFixedTime(new Date(`${day}T12:00:00+05:30`));
    await flow.pageText(viewer, 'custody');
    const table = page.getByRole('table', { name: 'Clearances' });
    await table.getByRole('row').nth(1).waitFor();
    const rows = await table.getByRole('row').all();
    const statuses = [];
    for (const row of rows) {
      const cells = await row.getByRole('cell').allInnerTexts();
      if (cells[0] === personName && cells[2] === leavingDay) statuses.push(cells[4]);
    }
    return statuses;
  }

  // ---- Transfers ----

  async request(by, assetNames, { kind = 'Between sites', from = 'ATK 1501', to = 'Enchakkal WH 9151', toEntity } = {}) {
    const flow = this.flow;
    const row = { transfer_kind: kind, from_place: await flow.place(from), to_place: await flow.place(to), reason: 'Store refit' };
    if (toEntity) row.to_entity = await flow.entity(toEntity);
    const transfer = await this.save(by, 'equipment.transfer', row);
    for (const name of assetNames) {
      const line = await this.save(by, 'equipment.transfer_line', { transfer: transfer.row_id, asset: await flow.asset(name, from) });
      this.lines[name] = line.row_id;
    }
    this.transfer = transfer.row_id;
    this.requester = by;
    return transfer;
  }

  async decide(by, state, attempt = false, transfer = this.transfer) {
    return this.change(by, 'equipment.transfer', transfer, { transfer_state: state }, attempt);
  }

  async dispatch(by, transporter = 'Own van') {
    const flow = this.flow;
    const scanned = Object.keys(this.lines).map(name => flow.assets[name]);
    return this.act(by, 'dispatch_transfer', { transfer: this.transfer, transporter, scanned });
  }

  async receive(by, assetName, outcome) {
    return this.act(by, 'receive_line', { line: this.lines[assetName], outcome });
  }

  async transferRow() {
    return this.flow.get('equipment.transfer', this.transfer);
  }

  async openTransfer(person) {
    const page = await this.flow.page(person);
    await this.flow.pageText(person, `transfer=${encodeURIComponent(this.transfer)}`);
    return page;
  }

  /** On the transfer's page: name the transporter, scan each item's tag, dispatch. */
  async scanOut(person, transporter) {
    const page = await this.openTransfer(person);
    await page.getByLabel('Transporter or vendor').fill(transporter);
    for (const name of Object.keys(this.lines)) {
      await page.getByLabel('Scan tag').fill(this.flow.assets[name]);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('list', { name: 'Scanned' }).getByText(name, { exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'Dispatch', exact: true }).click();
    await page.locator('.transfer-route').getByText('Dispatched', { exact: true }).waitFor();
  }

  /** On the transfer's page: choose how each item arrived and receive it. */
  async receiveOnPage(person, outcomes) {
    const page = await this.openTransfer(person);
    for (const [name, outcome] of Object.entries(outcomes)) {
      const item = page.locator('ul.transfer-receive').getByRole('listitem', { name });
      await item.getByRole('combobox', { name: `Outcome for ${name}` }).selectOption(outcome);
      await item.getByRole('button', { name: 'Receive' }).click();
      await page.getByRole('region', { name: 'Items' }).getByRole('listitem').filter({ hasText: name }).filter({ hasText: outcome }).waitFor();
    }
  }

  /** On the transfer's page: record Finance's SAP reference. */
  async confirmFinanceOnPage(person, reference) {
    const page = await this.openTransfer(person);
    await page.getByLabel('SAP transaction reference').fill(reference);
    await page.getByRole('button', { name: 'Confirm Finance' }).click();
    await page.getByRole('status').filter({ hasText: `Finance confirmed ${reference}` }).waitFor();
  }

  /** The receipt clock shown for this transfer on the Transfers list, as the page sees it at `at`. */
  async receiptClockAt(person, at) {
    const flow = this.flow;
    const page = await flow.page(person);
    await page.clock.setFixedTime(at);
    await flow.pageText(person, 'transfers');
    const row = page.getByRole('table', { name: 'Transfers' }).getByRole('row')
      .filter({ has: page.locator(`a[href="#transfer=${encodeURIComponent(this.transfer)}"]`) });
    return row.locator('.transfer-clock').innerText();
  }

  // ---- An asset's page ----

  async assetPage(person, assetName) {
    return this.flow.pageText(person, `asset=${encodeURIComponent(this.flow.assets[assetName])}`);
  }

  /** What an asset's page shows: its states (Condition, Custody…) and facts (Legal owner, Custodian…). */
  async assetFacts(person, assetName) {
    const page = await this.flow.page(person);
    await this.assetPage(person, assetName);
    const facts = {};
    for (const state of await page.getByRole('list', { name: 'States' }).getByRole('listitem').allInnerTexts()) {
      const [label, ...rest] = state.split(': ');
      facts[label.trim()] = rest.join(': ').trim();
    }
    for (const pair of await page.locator('dl.asset-facts > div').all())
      facts[(await pair.locator('dt').innerText()).trim()] = (await pair.locator('dd').innerText()).trim();
    return facts;
  }

  /** The entries of "Custody and movements" on an asset's page. */
  async movements(person, assetName) {
    const page = await this.flow.page(person);
    await this.assetPage(person, assetName);
    const list = page.locator('ul.asset-movements');
    await list.waitFor();
    return list.getByRole('listitem').allInnerTexts();
  }

  async personName(id) {
    return (await this.flow.get('Person', id)).full_name;
  }
}

const custody = flow => (flow.custody ??= new Custody(flow));

module.exports = { custody, PC, HOUR };
