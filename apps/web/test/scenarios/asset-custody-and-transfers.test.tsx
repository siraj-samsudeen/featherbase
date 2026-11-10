// asset-custody-and-transfers's scenarios (#1070): each test is one fenced
// scenario of openspec/specs/asset-custody-and-transfers/spec.md, step by
// step, with the Assets app rendered in jsdom against the real in-process
// server.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, screenSession } from '../pg-test'
import { Assets, type Row, realTime } from './assets'

const scenario = scenarioFor(test, 'asset-custody-and-transfers')
afterEach(realTime)

const PC = 'Billing PC, till 3'
const ACS = ['Voltas AC 1', 'Voltas AC 2']
const AC = 'Voltas AC'
const DG = 'Kirloskar DG'
const HOUR = 3_600_000
const SHOWN_DATE = /\d{2}-[A-Z][a-z]{2}-\d{4}/
type Facts = Record<string, string>

/** Custody, clearances and transfers in the Assets app, driven as named people. */
class Custody {
  custody = '' // the current custody row_id
  transfer = '' // the current transfer row_id
  lines: Record<string, string> = {} // asset name -> transfer line row_id
  clearance = ''

  constructor(readonly assets: Assets) {}

  // ---- Custody ----

  async issue(assetName: string, person: string, by = 'a manager') {
    const asset = await this.assets.asset(assetName)
    const custody = await this.assets.act(by, 'issue_custody', { asset, person: await this.assets.who(person), kind: 'Employee' })
    this.custody = custody.row_id
    return custody
  }

  custodyRow() { return this.assets.get('equipment.custody', this.custody) }

  /** The custodian answers over HTTP; `attempt` keeps a refusal in `last`. */
  answer(person: string, state: string, attempt = false) {
    return this.assets.change(person, 'equipment.custody', this.custody, { custody_state: state }, attempt)
  }

  /** The custodian presses a button on their own asset under "Your assets". */
  async pressOnMine(person: string, assetName: string, button: string, expectedState: string) {
    await this.assets.open(person, 'custody')
    const item = `[aria-labelledby="your-assets"] li[aria-label=${JSON.stringify(assetName)}]`
    await screenSession().within(item, (mine) => mine.clickButton(button))
      .within(`${item} > b`, (state) => state.assertExactText(expectedState))
  }

  /** A manager presses the take-back button on the asset's row in "Who holds what". */
  async takeBack(manager: string, assetName: string, button: string) {
    await this.assets.open(manager, 'custody')
    const table = await screen.findByRole('table', { name: 'Custody' })
    const id = this.assets.assets[assetName]!
    // The asset's row, found by its link, until it is gone: the DSL scopes by selector and has no verb for disappearance yet.
    const row = await waitFor(() => {
      const link = table.querySelector(`a[href="#asset=${encodeURIComponent(id)}"]`)
      expect(link, `${assetName} is not in Who holds what`).not.toBeNull()
      return link!.closest('tr') as HTMLElement
    })
    await userEvent.setup().click(within(row).getByRole('button', { name: button }))
    await waitFor(() => expect(row).not.toBeInTheDocument())
  }

  // ---- Clearances ----

  async openClearance(person: string, leavingDate: string, by = 'a manager') {
    const row = await this.assets.save(by, 'equipment.clearance', { person: await this.assets.who(person), reason: 'Leaving', leaving_date: leavingDate })
    this.clearance = row.row_id
    return row
  }

  closeClearance(by: string, attempt = false) {
    return this.assets.change(by, 'equipment.clearance', this.clearance, { clearance_state: 'Cleared' }, attempt)
  }

  /** The status on each clearance row for this person and leaving day, on the Custody page as it looks on `day`. */
  async clearanceStatuses(viewer: string, personName: string, leavingDay: string, day: string) {
    this.assets.setClock(`${day}T12:00:00+05:30`)
    await this.assets.open(viewer, 'custody')
    const table = await screen.findByRole('table', { name: 'Clearances' })
    // Rows by their cells: the DSL reads text, not tables.
    const rows = () => within(table).getAllByRole('row').map(row => within(row).queryAllByRole('cell').map(cell => cell.textContent!.trim()))
      .filter(cells => cells[0] === personName && cells[2] === leavingDay)
    await waitFor(() => expect(rows().length, 'his clearance is not listed').toBeGreaterThan(0))
    return rows().map(cells => cells[4]!)
  }

  // ---- Transfers ----

  async request(by: string, assetNames: string[], { kind = 'Between sites', from = 'ATK 1501', to = 'Enchakkal WH 9151', toEntity }: { kind?: string; from?: string; to?: string; toEntity?: string } = {}) {
    const row: Record<string, unknown> = { transfer_kind: kind, from_place: await this.assets.place(from), to_place: await this.assets.place(to), reason: 'Store refit' }
    if (toEntity) row.to_entity = await this.assets.entity(toEntity)
    const transfer = await this.assets.save(by, 'equipment.transfer', row)
    for (const name of assetNames) {
      const line = await this.assets.save(by, 'equipment.transfer_line', { transfer: transfer.row_id, asset: await this.assets.asset(name, from) })
      this.lines[name] = line.row_id
    }
    this.transfer = transfer.row_id
    return transfer
  }

  decide(by: string, state: string, attempt = false) {
    return this.assets.change(by, 'equipment.transfer', this.transfer, { transfer_state: state }, attempt)
  }

  dispatch(by: string, transporter = 'Own van') {
    const scanned = Object.keys(this.lines).map(name => this.assets.assets[name])
    return this.assets.act(by, 'dispatch_transfer', { transfer: this.transfer, transporter, scanned })
  }

  receive(by: string, assetName: string, outcome: string) {
    return this.assets.act(by, 'receive_line', { line: this.lines[assetName], outcome })
  }

  transferRow() { return this.assets.get('equipment.transfer', this.transfer) }

  async openTransfer(person: string) {
    await this.assets.open(person, `transfer=${encodeURIComponent(this.transfer)}`)
  }

  /** On the transfer's page: name the transporter, scan each item's tag, dispatch. */
  async scanOut(person: string, transporter: string) {
    await this.openTransfer(person)
    const page = screenSession().fillIn('Transporter or vendor', transporter)
    for (const name of Object.keys(this.lines)) {
      page
        .fillIn('Scan tag', this.assets.assets[name]!)
        .clickButton('Add')
        // Exactly the name: an item not on this transfer reads "<name> · not on this transfer".
        .until(`${name} is scanned`, () => [...document.querySelectorAll('[aria-label="Scanned"] li')].some(li => li.textContent === name))
    }
    await page
      .clickButton('Dispatch')
      .until('the route reads Dispatched', () => document.querySelector('.transfer-route .transfer-stage')?.textContent === 'Dispatched')
  }

  /** On the transfer's page: choose how each item arrived and receive it. */
  async receiveOnPage(person: string, outcomes: Record<string, string>) {
    await this.openTransfer(person)
    for (const [name, outcome] of Object.entries(outcomes)) {
      const item = `ul.transfer-receive li[aria-label=${JSON.stringify(name)}]`
      await screenSession().within(item, (line) => line.selectOption(`Outcome for ${name}`, outcome))
      // Enabled once the outcome is chosen: the DSL has no verb for a button being enabled.
      await waitFor(() => expect(within(document.querySelector(item) as HTMLElement).getByRole('button', { name: 'Receive' })).toBeEnabled())
      await screenSession().within(item, (line) => line.clickButton('Receive'))
      // Every item, read whole: the DSL reads text, not lists.
      await waitFor(() => {
        const items = within(screen.getByRole('region', { name: 'Items' })).getAllByRole('listitem').map(li => li.textContent!)
        expect(items.some(text => text.includes(name) && text.includes(outcome)), `Items: ${items.join(' | ')}`).toBe(true)
      }, { timeout: 8000 })
    }
  }

  /** On the transfer's page: record Finance's SAP reference. */
  async confirmFinanceOnPage(person: string, reference: string) {
    await this.openTransfer(person)
    await screenSession().fillIn('SAP transaction reference', reference).clickButton('Confirm Finance')
    // In any of the page's statuses: within scopes to the first match only.
    await waitFor(() => expect(screen.getAllByRole('status').some(s => s.textContent!.includes(`Finance confirmed ${reference}`))).toBe(true))
  }

  /** The receipt clock shown for this transfer on the Transfers list, as the page sees it at `at`. */
  async receiptClockAt(person: string, at: number) {
    this.assets.setClock(at)
    await this.assets.open(person, 'transfers')
    const table = await screen.findByRole('table', { name: 'Transfers' })
    // Returned for its callers to compare: the transfer's row is found by its link.
    const clock = await waitFor(() => {
      const row = table.querySelector(`a[href="#transfer=${encodeURIComponent(this.transfer)}"]`)?.closest('tr')
      expect(row, 'the transfer is not listed').toBeTruthy()
      return row!.querySelector('.transfer-clock') as HTMLElement
    })
    return clock.textContent!.trim()
  }

  // ---- An asset's page ----

  /**
   * What an asset's page shows, its states (Condition, Custody…) and facts
   * (Legal owner, Custodian…), once they pass `check`: names arrive after the page.
   */
  async assetFacts(person: string, assetName: string, check: (facts: Facts) => void) {
    await this.assets.open(person, `asset=${encodeURIComponent(this.assets.assets[assetName]!)}`)
    await screen.findByRole('heading', { name: assetName })
    return waitFor(() => {
      const facts: Facts = {}
      for (const state of within(screen.getByRole('list', { name: 'States' })).getAllByRole('listitem').map(li => li.textContent!)) {
        const [label, ...rest] = state.split(': ')
        facts[label!.trim()] = rest.join(': ').trim()
      }
      for (const pair of document.querySelectorAll('dl.asset-facts > div'))
        facts[pair.querySelector('dt')!.textContent!.trim()] = pair.querySelector('dd')!.textContent!.trim()
      check(facts)
      return facts
    }, { timeout: 8000 })
  }

  /** The entries of "Custody and movements" on an asset's page, once they include one matching `until`. */
  async movements(person: string, assetName: string, until: RegExp) {
    await this.assets.open(person, `asset=${encodeURIComponent(this.assets.assets[assetName]!)}`)
    return waitFor(() => {
      const list = document.querySelector('ul.asset-movements')
      expect(list, 'the page has no custody and movements').not.toBeNull()
      const entries = within(list as HTMLElement).getAllByRole('listitem').map(li => li.textContent!)
      expect(entries.some(e => until.test(e)), entries.join('\n')).toBe(true)
      return entries
    }, { timeout: 8000 })
  }
}

async function world(fixtures: Parameters<typeof Assets.start>[0]) {
  const assets = await Assets.start(fixtures)
  return { assets, c: new Custody(assets) }
}

async function sureshHoldsPc(c: Custody) {
  await c.issue(PC, 'Suresh')
  await c.answer('Suresh', 'Accepted')
}

describe('asset-custody-and-transfers', () => {
  scenario('Suresh accepts the billing PC', async ({ createUser, admin }, step) => {
    const { c } = await world({ createUser, admin })
    await step('a manager issues the billing PC to Suresh', () => c.issue(PC, 'Suresh'))
    await step('Suresh accepts it', () => c.pressOnMine('Suresh', PC, 'Accept', 'Accepted'))
    await step('the billing PC is with Suresh, accepted', async () => {
      await c.assetFacts('a manager', PC, facts => {
        expect(facts.Custodian).toBe('Suresh')
        expect(facts.Custody).toBe('With custodian')
      })
      expect((await c.custodyRow()).custody_state).toBe('Accepted')
      const entries = await c.movements('a manager', PC, /Issued to Suresh/)
      expect(entries.some(e => e.includes('Issued to Suresh · Accepted')), entries.join('\n')).toBe(true)
    })
  })

  scenario('Someone else cannot accept for him', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('the billing PC is issued to Suresh and waiting', async () => {
      await c.issue(PC, 'Suresh')
      expect((await c.custodyRow()).custody_state).toBe('Pending')
    })
    await step('another member tries to accept it', () => c.answer('another member', 'Accepted', true))
    await step('the answer is refused, saying only Suresh can answer', async () => {
      assets.refused(/Only the person it was issued to can answer/)
      expect((await c.custodyRow()).custody_state).toBe('Pending')
    })
  })

  scenario('Suresh hands the PC back', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('Suresh holds the billing PC', () => sureshHoldsPc(c))
    await step('he hands it back and a manager accepts the return', async () => {
      await c.pressOnMine('Suresh', PC, 'Hand back', 'Hand-back requested')
      await c.takeBack('a manager', PC, 'Accept return')
    })
    await step('the billing PC is at its location with no custodian', async () => {
      await c.assetFacts('a manager', PC, facts => {
        expect(facts.Custody).toBe('At location')
        expect(facts.Custodian).toBe('—')
      })
      const asset = await assets.get('equipment.asset', assets.assets[PC]!)
      expect(asset.place).toBe(await assets.place('ATK 1501'))
      expect(asset.custodian).toBeNull()
    })
  })

  scenario('Clearance needs every asset back', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('Suresh is leaving on 30 November 2026 and still holds the billing PC', async () => {
      await sureshHoldsPc(c)
      await c.openClearance('Suresh', '2026-11-30')
    })
    await step('a manager tries to close his clearance', () => c.closeClearance('a manager', true))
    await step('closing is refused until the PC is returned or reassigned', async () => {
      assets.refused(/Return or reassign every asset before clearing/)
      expect((await assets.get('equipment.clearance', c.clearance)).clearance_state).toBe('Open')
      // Once the PC is back, the same close goes through.
      await assets.act('a manager', 'return_custody', { custody: c.custody })
      const closed = await c.closeClearance('a manager')
      expect(closed.clearance_state).toBe('Cleared')
    })
  })

  scenario('Past the leaving date', async ({ createUser, admin }, step) => {
    const { c } = await world({ createUser, admin })
    let statuses: string[] = []
    await step('Suresh left on 5 November 2026 and still holds the billing PC', async () => {
      await sureshHoldsPc(c)
      await c.openClearance('Suresh', '2026-11-05')
    })
    await step('anyone opens his clearance on 7 November 2026', async () => {
      // Only Assets Managers see clearances; the page is read with the calendar on that day.
      statuses = await c.clearanceStatuses('a manager', 'Suresh', '05-Nov-2026', '2026-11-07')
    })
    await step('it shows that it needs escalation to HR and Operations', () => {
      expect(statuses.length, 'his clearance is not listed').toBeGreaterThanOrEqual(1)
      for (const status of statuses) expect(status).toMatch(/^Escalate to HR and Operations: 1 asset not returned$/)
    })
  })

  scenario('The requester cannot approve', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('Meena requests moving two ACs from ATK 1501 to Enchakkal WH 9151', () => c.request('Meena', ACS))
    await step('Meena approves her own request', () => c.decide('Meena', 'Approved', true))
    await step('the approval is refused, saying someone else approves', async () => {
      assets.refused(/Someone other than the requester approves a transfer/)
      expect((await c.transferRow()).transfer_state).toBe('Requested')
    })
  })

  scenario('One transfer at a time', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('the AC is on an approved transfer', async () => {
      await c.request('Meena', [AC])
      await c.decide('a manager', 'Approved')
    })
    await step('a manager adds the AC to another transfer', async () => {
      const other = await assets.save('a manager', 'equipment.transfer',
        { transfer_kind: 'Within site', from_place: await assets.place('ATK 1501'), to_place: await assets.place('ATK 1501'), reason: 'Move to billing' })
      await assets.save('a manager', 'equipment.transfer_line', { transfer: other.row_id, asset: assets.assets[AC] }, true)
    })
    await step('it is refused, saying the AC is already on a transfer', () => assets.refused(new RegExp(`${AC} is already on transfer TRF-`)))
  })

  scenario('Dispatch the ACs', async ({ createUser, admin }, step) => {
    const { c } = await world({ createUser, admin })
    await step('the transfer of two ACs is approved', async () => {
      await c.request('a manager', ACS)
      await c.decide('Meena', 'Approved')
    })
    await step('Meena scans both out with transporter "Sri Murugan Logistics"', async () => {
      await c.scanOut('Meena', 'Sri Murugan Logistics')
      expect((await c.transferRow()).transporter).toBe('Sri Murugan Logistics')
    })
    await step('both ACs are in transit, due within 3 days', async () => {
      for (const name of ACS) await c.assetFacts('Meena', name, facts => expect(facts.Custody).toBe('In transit'))
      const transfer = await c.transferRow()
      expect(Date.parse(String(transfer.expected_receipt_at)) - Date.parse(String(transfer.dispatched_at))).toBe(3 * 24 * HOUR)
    })
  })

  scenario('One received good, one damaged', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('two ACs are in transit to Enchakkal WH 9151', async () => {
      await c.request('Meena', ACS)
      await c.decide('a manager', 'Approved')
      await c.dispatch('Meena')
    })
    await step('a manager receives one as good and one as damaged', () =>
      c.receiveOnPage('a manager', { [ACS[0]!]: 'Received good', [ACS[1]!]: 'Received damaged' }))
    await step('both ACs are at Enchakkal WH 9151 and the damaged one shows condition Damaged', async () => {
      const enchakkal = await assets.place('Enchakkal WH 9151')
      for (const name of ACS) expect((await assets.get('equipment.asset', assets.assets[name]!)).place).toBe(enchakkal)
      await c.assetFacts('a manager', ACS[1]!, facts => expect(facts.Condition).toBe('Damaged'))
      await c.assetFacts('a manager', ACS[0]!, facts => {
        expect(facts.Condition).toBeTruthy()
        expect(facts.Condition).not.toBe('Damaged')
      })
    })
  })

  scenario('Late in transit', async ({ createUser, admin }, step) => {
    const { c } = await world({ createUser, admin })
    let viewAt = 0
    await step('a transfer between sites was dispatched 4 days ago and is not received', async () => {
      await c.request('Meena', ACS, { kind: 'Between sites' })
      await c.decide('a manager', 'Approved')
      const sent = await c.dispatch('Meena') as Row
      // The server stamps the dispatch now; the page is then read as it looks that many days later.
      viewAt = Date.parse(String(sent.dispatched_at)) + 4 * 24 * HOUR
    })
    await step('it shows as late', async () => {
      expect((await c.transferRow()).transfer_state).toBe('Dispatched')
      expect(await c.receiptClockAt('a manager', viewAt)).toMatch(/^Late by /)
    })
  })

  scenario('Ownership waits for SAP', async ({ createUser, admin }, step) => {
    const { assets, c } = await world({ createUser, admin })
    await step('a transfer of the DG from JRPL to KAIPL is received', async () => {
      await assets.asset(DG, 'ATK 1501', { owner_entity: await assets.entity('JRPL') })
      await c.request('a manager', [DG], { kind: 'Between companies', toEntity: 'KAIPL' })
      await c.decide('Meena', 'Approved')
      await c.dispatch('a manager')
      await c.receive('Meena', DG, 'Received good')
      expect((await c.transferRow()).transfer_state).toBe('Received')
    })
    await step('nobody has confirmed the SAP transaction', async () => expect((await c.transferRow()).finance_confirmed_at).toBeNull())
    await step('the DG is still owned by JRPL', () => c.assetFacts('a manager', DG, facts => expect(facts['Legal owner']).toMatch(/^JRPL\b/)))
    await step('once Finance confirms SAP document 4900012345 the DG is owned by KAIPL', async () => {
      // Finance's confirmation is recorded by someone other than the requester.
      await c.confirmFinanceOnPage('the asset accountant', '4900012345')
      await c.assetFacts('a manager', DG, facts => expect(facts['Legal owner']).toMatch(/^KAIPL\b/))
    })
  })

  scenario("The PC's history", async ({ createUser, admin }, step) => {
    const { c } = await world({ createUser, admin })
    let entries: string[] = []
    await step('the billing PC was issued to Suresh and later moved to Enchakkal WH 9151', async () => {
      await sureshHoldsPc(c)
      await c.request('a manager', [PC])
      await c.decide('Meena', 'Approved')
      await c.dispatch('a manager')
      await c.receive('Meena', PC, 'Received good')
    })
    await step('anyone opens its page', async () => {
      entries = await c.movements('a member', PC, /→ Enchakkal WH 9151/)
    })
    await step('it lists the issue to Suresh and the move to Enchakkal, each with its date', () => {
      const issue = entries.find(e => e.includes('Issued to Suresh'))
      const move = entries.find(e => e.includes('→ Enchakkal WH 9151'))
      expect(issue, `no issue to Suresh in:\n${entries.join('\n')}`).toBeTruthy()
      expect(move, `no move to Enchakkal in:\n${entries.join('\n')}`).toBeTruthy()
      expect(issue).toMatch(SHOWN_DATE)
      expect(move).toMatch(SHOWN_DATE)
    })
  })
})
