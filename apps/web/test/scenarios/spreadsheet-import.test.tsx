// spreadsheet-import's fenced scenarios a person works through in the Import
// Wizard (#1070), rendered in jsdom against the real in-process server: the
// matching column it offers, the append and change-count gates, what a check
// reports, a Choice picked by hand, refusals that say why, and importing again
// after the connection drops. The matching analysis a restricted person gets
// from the API is in apps/server/test/scenarios/.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, vi } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { tableHref } from 'shared'
import { scenarioFor } from 'server/test/scenario'
import { importedEarlier, importedZones, populations, populationsOf, zoneCount, zonesCsv, type ImportedZones, type Zone, type ZoneOptions } from 'server/test/reimport-zones'
import { clearSession } from '../../src/lib/import-session'
import { test, expect, renderApp, onScreen } from '../pg-test'

const scenario = scenarioFor(test, 'spreadsheet-import')
const WAIT = { timeout: 20_000 }
const enc = encodeURIComponent
type User = ReturnType<typeof userEvent.setup>

// ---- The page's requests: counted so a check can wait for them to settle,
// and a dropped connection stands in for the ones to :import ----

let pending = 0
let dropImport: (() => Promise<Response>) | null = null
beforeEach(() => {
  const bridged = globalThis.fetch
  pending = 0
  dropImport = null
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (dropImport && /:import(\?|$)/.test(url)) return dropImport()
    pending++
    try {
      return await bridged(input, init)
    } finally {
      pending--
    }
  })
  clearSession()
})
afterEach(() => {
  vi.restoreAllMocks()
  clearSession()
})

/** Waits until the page has had no request in flight for a while. */
async function settle() {
  let quiet = 0
  for (const start = Date.now(); quiet < 4 && Date.now() - start < 15_000; await new Promise((r) => setTimeout(r, 75))) quiet = pending ? 0 : quiet + 1
}

const badGateway = () => new Response('bad gateway', { status: 502 })

// ---- The Import Wizard ----

function csvFile(text: string, name: string) {
  const bytes = new TextEncoder().encode(text).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  return file
}

class Wizard {
  constructor(readonly user: User) {}

  card = () => screen.getByTestId('iw-sheet-0')
  text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')

  /** Enter from the existing table's list, just as a returning importer does. */
  async openForTable(as: TestClient, table: string) {
    cleanup()
    await renderApp(tableHref(table), as)
    await onScreen().clickButton('List actions')
    await this.user.click(await screen.findByTestId('open-import'))
    await screen.findByTestId('import-wizard', {}, WAIT)
  }

  async openNew(as: TestClient) {
    cleanup()
    await renderApp('/featherbase/admin/import', as)
    await screen.findByTestId('import-wizard', {}, WAIT)
  }

  async dropCsv(name: string, csv: string) {
    fireEvent.change(await screen.findByTestId('iw-file-input', {}, WAIT), { target: { files: [csvFile(csv, name)] } })
    await screen.findByTestId('iw-target-0', {}, WAIT)
  }

  async settleChoices() {
    await screen.findByTestId('iw-key-0', {}, WAIT)
    await settle()
  }

  // By the column's name, the option's value: the option shows the column's label.
  async matchOn(column: string) {
    await this.user.selectOptions(screen.getByTestId('iw-key-0'), column)
    await screen.findByTestId('iw-preview-0', {}, WAIT)
  }

  async check() {
    await this.user.click(screen.getByTestId('iw-check'))
    await screen.findByTestId('iw-check-0', {}, WAIT)
  }

  activeKey = () => (screen.getByTestId('iw-key-0') as HTMLSelectElement).value
  keyChoices = () => [...(screen.getByTestId('iw-key-0') as HTMLSelectElement).options].map((o) => o.value)
  matchButton = (label: string) => within(this.card()).queryByRole('button', { name: `Match on ${label}` })

  async offersMatchingOn(label: string) {
    await settle()
    return this.matchButton(label) !== null
  }

  async acceptMatchingOn(label: string) {
    const accept = this.matchButton(label)
    if (!accept) throw new Error(`No explicit "Match on ${label}" suggestion to accept. ${this.text(this.card())}`)
    await this.user.click(accept)
    await screen.findByTestId('iw-preview-0', {}, WAIT)
  }

  explainsMatchingOn(label: string) {
    const explanation = this.text(this.card())
    return ['match', 'matching', 'matched', 'matches'].some((verb) => explanation.toLowerCase().includes(`${verb} on ${label.toLowerCase()}`))
      && !/rows (?:will be |are )?(?:appended|added to it)|always adds? (?:new )?rows/i.test(explanation)
  }

  async unmapFirstColumn() {
    await this.user.click(screen.getByTestId('iw-map-use-0-0'))
    expect(screen.getByTestId('iw-map-use-0-0')).not.toBeChecked()
    await this.settleChoices()
  }

  /** Observe whichever gate (or actual completion) a click reaches. Never bypass it. */
  async attemptImport() {
    await this.user.click(screen.getByTestId('iw-import'))
    await waitFor(() => expect(['iw-confirm-updates', 'iw-append-warning', 'iw-done', 'list-view'].some((id) => screen.queryByTestId(id))).toBe(true), { timeout: 30_000 })
  }

  confirmationText = () => (screen.queryByTestId('iw-confirm-updates')?.textContent ?? '')
  appendWarningText = () => (screen.queryByTestId('iw-append-warning')?.textContent ?? '')
  completed = () => screen.queryByTestId('iw-done') !== null || screen.queryByTestId('list-view') !== null

  async acknowledgeAppend() {
    if (!screen.queryByTestId('iw-append-warning'))
      throw new Error('Missing full-overlap append warning: import already proceeded without acknowledgement')
    await onScreen().check('Add another set of rows')
    await this.user.click(screen.getByTestId('iw-append-go'))
    await waitFor(() => expect(this.completed()).toBe(true), { timeout: 30_000 })
  }

  async missingAndWrongCountsBlock() {
    const input = screen.getByTestId('iw-confirm-input')
    const go = screen.getByTestId('iw-confirm-go')
    await this.user.clear(input)
    if (!(go as HTMLButtonElement).disabled) return false
    await this.user.type(input, '20')
    if (!(go as HTMLButtonElement).disabled) return false
    await this.user.clear(input)
    await this.user.type(input, '21')
    return !(go as HTMLButtonElement).disabled && !this.completed()
  }

  async latestHistoryText(as: TestClient, table: string) {
    if (!this.completed()) throw new Error(`Import has not completed: ${this.confirmationText()}`)
    await this.openForTable(as, table)
    return this.text(await screen.findByTestId('iw-run-0', {}, WAIT))
  }

  async unchangedUndoText() {
    await this.user.click(screen.getByTestId('iw-revert-open-h0'))
    return this.text(await screen.findByTestId('iw-revert-preview-h0', {}, WAIT))
  }

  // ---- A new table's columns ----

  async asNewTable(name: string) {
    const target = screen.getByTestId('iw-target-0') as HTMLInputElement
    if (target.value !== 'New Table…') {
      await this.user.click(target)
      await this.user.click(await screen.findByTestId('iw-target-new-0'))
    }
    await screen.findByTestId('iw-new-name-0', {}, WAIT)
    await onScreen().fillIn('New Table name', name)
  }

  columnRow(label: string) {
    const rows = [...screen.getByTestId('iw-new-grid-0').querySelectorAll<HTMLElement>('tbody tr[data-columnrow]')]
    const row = rows.find((r) => r.querySelector<HTMLInputElement>('[data-rowfield=label]')?.value === label)
    if (!row) throw new Error(`The Import Wizard has no column "${label}"`)
    return row
  }

  async setType(label: string, type: string) {
    await this.user.selectOptions(this.columnRow(label).querySelector<HTMLSelectElement>('[data-rowfield=column_type]')!, type)
  }

  async setColumnName(label: string, name: string) {
    const input = this.columnRow(label).querySelector<HTMLInputElement>('[data-rowfield=column_name]')!
    await this.user.clear(input)
    await this.user.type(input, name)
  }

  optionsShown = (label: string) => (this.columnRow(label).querySelector('[data-rowfield=choices]')?.textContent ?? '').trim()

  async importAll() {
    await this.user.click(screen.getByTestId('iw-import'))
    await waitFor(() => expect(this.completed(), `The import did not finish. The page says: ${this.text(document.body).slice(0, 1500)}`).toBe(true), { timeout: 30_000 })
    const done = screen.queryByTestId('iw-done')
    if (done) expect(screen.getByTestId('iw-result-0').textContent).toMatch(/Imported \d+ rows? into/)
  }

  async waitUntilImportable() {
    await waitFor(() => expect(screen.getByTestId('iw-import')).toBeEnabled(), { timeout: 30_000 })
  }

  /** Clicks Import and waits for this target's refusal, then for the run to end. */
  async importExpectingFailure() {
    await this.user.click(screen.getByTestId('iw-import'))
    const failure = await screen.findByTestId('iw-failure-0', {}, { timeout: 30_000 })
    await this.waitUntilImportable()
    return (failure.textContent ?? '').replace(/\s+/g, ' ')
  }

  /** The failure on screen once it no longer reads as `previous`. */
  async failureAfter(previous: string) {
    return waitFor(() => {
      const text = (screen.getByTestId('iw-failure-0').textContent ?? '').replace(/\s+/g, ' ')
      expect(text).not.toBe(previous)
      return text
    }, { timeout: 30_000 })
  }
}

// ---- Re-importing the zones ----

type Reimport = ImportedZones & { wizard: Wizard; checked: boolean; incoming: Zone[] }

async function prepare(user: User, as: TestClient, zones: ImportedZones, opts: { population?: boolean; region?: boolean; check?: boolean; match?: boolean; changed?: number[]; unmap?: boolean } = {}): Promise<Reimport> {
  const { population = false, region = false, check = false, match = true, changed = [], unmap = false } = opts
  const rows = zones.rows.map((r) => ({ ...r }))
  if (population) rows[0]!.population += 7
  for (const index of changed) rows[index]!.population += 7
  if (region) rows[0]!.region = 'East'
  const wizard = new Wizard(user)
  await wizard.openForTable(as, zones.table)
  await wizard.dropCsv('zones.csv', zonesCsv(rows))
  await wizard.settleChoices()
  if (unmap) await wizard.unmapFirstColumn()
  if (match) await wizard.matchOn('zone_code')
  if (check) await wizard.check()
  return { ...zones, wizard, checked: check, incoming: rows }
}

/** The preview (or check) says each phrase, with no digit run into its count: 61 never satisfies 1. */
async function reports(r: Reimport, phrases: string[]) {
  await waitFor(() => {
    const text = r.wizard.text(screen.getByTestId(r.checked ? 'iw-check-0' : 'iw-preview-0'))
    for (const phrase of phrases) {
      const at = text.indexOf(phrase)
      const exactCount = at >= 0 && (at === 0 || Number.isNaN(Number.parseInt(text[at - 1]!, 10)))
      expect(exactCount, `Expected "${phrase}" in preview; received: ${text}`).toBe(true)
    }
  }, WAIT)
}

// ---- A sheet imported as a new table ----

const CHOICE_TABLE = 'Choice By Hand'
const csv = (rows: string[][]) => rows.map((r) => r.join(',')).join('\n')
const SECTIONS = (n: number) => [['Section', 'Code'], ...Array.from({ length: n * 3 }, (_, i) => [`Section ${String(i % n).padStart(2, '0')}`, `c${i}`])]
const ZONE_SHEET = [['Zone', 'Code'], ['North', 'x'], ['South', 'y']]

async function dropped(user: User, admin: TestClient, rows: string[][]) {
  const wizard = new Wizard(user)
  await wizard.openNew(admin)
  await wizard.dropCsv('sheet.csv', csv(rows))
  await wizard.asNewTable(CHOICE_TABLE)
  return wizard
}

const rowCount = async (admin: TestClient) => {
  const res = await admin.fetch(`/api/table/${enc(CHOICE_TABLE)}?fields=${enc('["row_id"]')}&limit_page_length=100`)
  return res.status === 200 ? ((await res.json()) as { data: unknown[] }).data.length : 0
}

async function holdsEveryRow(admin: TestClient, rows: string[][]) {
  await waitFor(async () => expect(await rowCount(admin)).toBe(rows.length - 1), WAIT)
}

const GIVEN_61 = 'the user has imported 61 zones with their populations'

describe('spreadsheet-import', () => {
  // ---- The matching column offered (#906) ----

  scenario('The same matching column is suggested next time', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step('the user has imported 61 zones matched on their zone codes', async () => { zones = await importedZones(admin, { keyed: true }) })
    await step('the user prepares the zones file for another import', async () => { r = await prepare(user, admin, zones, { match: false }) })
    await step('zone codes are offered as the remembered matching column', async () => {
      await waitFor(() => {
        const text = r.wizard.text(r.wizard.card())
        expect(text.includes('as last time') || text.includes('remembered'), `No remembered-key explanation: ${text}`).toBe(true)
      }, WAIT)
      expect(r.wizard.activeKey(), 'Remembered key must not activate itself').toBe('')
      expect(await r.wizard.offersMatchingOn('Zone Code'), 'Offer an explicit Match on Zone Code action').toBe(true)
    })
    await step('no matching column is active until the user accepts or chooses one', async () => {
      expect(r.wizard.activeKey()).toBe('')
      await r.wizard.acceptMatchingOn('Zone Code')
      expect(r.wizard.activeKey()).toBe('zone_code')
    })
  }, 60_000)

  scenario('A matching column is offered without a previous keyed import', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step('the user has imported 61 zones without choosing a matching column', async () => { zones = await importedZones(admin) })
    await step('the user prepares the identical zones file for another import', async () => { r = await prepare(user, admin, zones, { match: false }) })
    await step('zone codes are offered because each incoming code matches exactly one readable zone', async () =>
      expect(await r.wizard.offersMatchingOn('Zone Code'), 'Missing value-derived Match on Zone Code suggestion').toBe(true))
    await step('no matching column is active until the user accepts or chooses one', async () => {
      expect(r.wizard.activeKey()).toBe('')
      await r.wizard.acceptMatchingOn('Zone Code')
      expect(r.wizard.activeKey()).toBe('zone_code')
    })
  }, 60_000)

  scenario('Ambiguous values are not offered as a safe match', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step('the user has imported zones with repeated zone codes', async () => { zones = await importedZones(admin, { repeated: true }) })
    await step('the user prepares the zones file for another import', async () => { r = await prepare(user, admin, zones, { match: false }) })
    await step('the repeated zone codes are not offered as a one-to-one matching column', async () => {
      expect(await r.wizard.offersMatchingOn('Zone Code')).toBe(false)
      expect(r.wizard.activeKey()).toBe('')
    })
  }, 60_000)

  scenario('An unmapped remembered column is not offered', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step('the user has imported 61 zones matched on their zone codes', async () => { zones = await importedZones(admin, { keyed: true }) })
    await step('the user prepares another zones file without mapping its zone codes', async () => { r = await prepare(user, admin, zones, { match: false, unmap: true }) })
    await step('zone codes are not offered as a remembered matching column', async () => {
      expect(await r.wizard.offersMatchingOn('Zone Code')).toBe(false)
      expect(r.wizard.keyChoices()).not.toContain('zone_code')
      expect(r.wizard.activeKey()).toBe('')
    })
  }, 60_000)

  // ---- Appending, and the change-count gate ----

  scenario('Appending the identical file waits for acknowledgement', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user imports the identical zones file without choosing a matching column', async () => {
      r = await prepare(user, admin, zones, { match: false })
      await r.wizard.attemptImport()
    })
    await step('the import waits for acknowledgement that 61 more rows will be added', async () => {
      expect(await zoneCount(admin, zones.table), 'Appending must not write before acknowledgement').toBe(61)
      expect(r.wizard.appendWarningText(), 'Explain that appending adds 61 more rows').toContain('61 more rows')
      expect(r.wizard.completed()).toBe(false)
    })
    await step('the user can choose the suggested zone codes instead', async () => {
      await r.wizard.acceptMatchingOn('Zone Code')
      expect(r.wizard.activeKey()).toBe('zone_code')
      expect(r.wizard.appendWarningText(), 'Choosing a key clears the append warning').toBe('')
      expect(await zoneCount(admin, zones.table)).toBe(61)
    })
  }, 60_000)

  scenario('The acknowledged append adds the second set', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user has been warned that appending the identical zones file adds 61 more rows', async () => {
      r = await prepare(user, admin, zones, { match: false })
      await r.wizard.attemptImport()
      expect(r.wizard.appendWarningText(), 'Missing full-overlap warning before append').toContain('61 more rows')
      expect(await zoneCount(admin, zones.table)).toBe(61)
    })
    await step('the user explicitly acknowledges the append', () => r.wizard.acknowledgeAppend())
    await step('the zones contain 122 rows', async () => expect(await zoneCount(admin, zones.table)).toBe(122))
  }, 60_000)

  async function proceedsWithoutTypedCount(admin: TestClient, r: Reimport) {
    expect(r.wizard.confirmationText(), 'Unchanged matches must not count toward the typed-confirmation threshold').toBe('')
    expect(r.wizard.completed()).toBe(true)
    expect(await zoneCount(admin, r.table)).toBe(61)
    expect(await populations(admin, r.table)).toEqual(populationsOf(r.incoming))
  }

  async function waitsForTyped21(admin: TestClient, r: Reimport) {
    const text = r.wizard.confirmationText()
    expect(text, `Expected changed-only count 21, received: ${text}`).toContain('Type 21 to confirm')
    expect(r.wizard.completed()).toBe(false)
    expect(await zoneCount(admin, r.table)).toBe(r.rows.length)
    expect(await populations(admin, r.table)).toEqual(populationsOf(r.rows))
  }

  scenario('An identical large file needs no change confirmation', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user imports the identical zones file matched on its zone codes', async () => {
      r = await prepare(user, admin, zones)
      await r.wizard.attemptImport()
    })
    await step('the import proceeds without a typed change count', () => proceedsWithoutTypedCount(admin, r))
  }, 60_000)

  scenario('Twenty changed rows need no typed count', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user imports the zones file with 20 changed populations matched on its zone codes', async () => {
      r = await prepare(user, admin, zones, { changed: Array.from({ length: 20 }, (_, i) => i) })
      await r.wizard.attemptImport()
    })
    await step('the import proceeds without a typed change count', () => proceedsWithoutTypedCount(admin, r))
  }, 60_000)

  scenario('The count must be typed back', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user imports the zones file with 21 changed populations matched on its zone codes', async () => {
      r = await prepare(user, admin, zones, { changed: Array.from({ length: 21 }, (_, i) => i) })
      await r.wizard.attemptImport()
    })
    await step('the import waits for the user to type 21', () => waitsForTyped21(admin, r))
    await step('a missing or wrong count leaves the import blocked', async () => {
      expect(await r.wizard.missingAndWrongCountsBlock()).toBe(true)
      expect(await zoneCount(admin, zones.table)).toBe(61)
      expect(await populations(admin, zones.table)).toEqual(populationsOf(zones.rows))
    })
  }, 60_000)

  scenario('Changes in different parts count together', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step('the user has imported 520 zones with their populations', async () => { zones = await importedZones(admin, { count: 520 }) })
    await step('the user imports the zones file with 11 changed populations among its first 500 zones and 10 among its last 20 matched on zone codes', async () => {
      r = await prepare(user, admin, zones, { changed: [...Array.from({ length: 11 }, (_, i) => i), ...Array.from({ length: 10 }, (_, i) => 500 + i)] })
      await r.wizard.attemptImport()
    })
    await step('the import waits for the user to type 21', () => waitsForTyped21(admin, r))
  }, 90_000)

  // ---- What a check reports ----

  scenario('An identical file changes no values', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user chooses zone codes to match the identical zones file before requesting a check', async () => { r = await prepare(user, admin, zones) })
    await step('the preview reports 0 changed rows, 61 unchanged rows and 0 added rows', () => reports(r, ['0 rows change', '61 unchanged', '0 added']))
    await step('the preview reports 0 changed values and explains matching rather than appending', async () => {
      await reports(r, ['0 values change'])
      expect(r.wizard.explainsMatchingOn('Zone Code'), 'Explain matching on Zone Code, not appending').toBe(true)
    })
  }, 60_000)

  scenario('One changed population does not count the whole file', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => { zones = await importedZones(admin) })
    await step('the user checks the zones file with one changed population matched on its zone codes', async () => {
      r = await prepare(user, admin, zones, { population: true, check: true })
    })
    await step('the preview reports 1 changed row, 60 unchanged rows and 0 added rows', () => reports(r, ['1 row changes', '60 unchanged', '0 added']))
    await step('the preview reports 1 changed value', () => reports(r, ['1 value changes']))
  }, 60_000)

  scenario('An unchanged re-import is still recorded', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step(GIVEN_61, async () => {
      zones = await importedZones(admin)
      await importedEarlier(zones.table)
    })
    await step('the user imports the identical zones file matched on its zone codes', async () => {
      r = await prepare(user, admin, zones)
      await r.wizard.attemptImport()
    })
    await step('import history records 61 processed matches rather than 61 value changes', async () => {
      const text = await r.wizard.latestHistoryText(admin, zones.table)
      expect(text.includes('61 matched') || text.includes('61 processed'), `Historical counts must be labelled matched/processed: ${text}`).toBe(true)
      expect(text).not.toContain('61 changed')
    })
    await step('undoing that import reports that the 61 matched rows had no values changed', async () => {
      const text = await r.wizard.unchangedUndoText()
      expect(text.includes('restore 0') && text.includes('delete 0'), `No values should need restoring: ${text}`).toBe(true)
      expect(text.split('no changes to undo').length - 1, 'All 61 matches must be classified unchanged by undo').toBe(61)
      expect(await zoneCount(admin, zones.table)).toBe(61)
    })
  }, 60_000)

  scenario('Check a correction', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step("the user has imported 61 zones and corrected the first zone's region from North to South", async () => {
      zones = await importedZones(admin, { corrected: true })
    })
    await step('the user checks a zones file matched on zone codes with a new East region and a changed population for that zone', async () => {
      r = await prepare(user, admin, zones, { population: true, region: true, check: true })
    })
    await step("the preview reports 1 changed row and 1 row keeping the user's correction", () => reports(r, ['1 row changes', '1 row keeps your corrections']))
    await step('it reports 1 changed value, 1 retained value and 1 new conflict', () => reports(r, ['1 value changes', '1 value retained', '1 new conflict']))
  }, 60_000)

  scenario('The previous source retains the correction without another conflict', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step("the user has imported 61 zones and corrected the first zone's region from North to South", async () => {
      zones = await importedZones(admin, { corrected: true })
    })
    await step('the user checks the original zones file matched on its zone codes', async () => { r = await prepare(user, admin, zones, { check: true }) })
    await step("the preview reports 0 changed rows, 61 unchanged rows and 1 row keeping the user's correction", () =>
      reports(r, ['0 rows change', '61 unchanged', '1 row keeps your corrections']))
    await step('it reports 1 retained value and 0 new conflicts', () => reports(r, ['1 value retained', '0 new conflicts']))
  }, 60_000)

  scenario('No-history overwrites are explained', async ({ admin }, step) => {
    const user = userEvent.setup()
    let zones!: ImportedZones
    let r!: Reimport
    await step("the user has imported 61 zones without change history and corrected the first zone's region", async () => {
      zones = await importedZones(admin, { corrected: true, history: false } satisfies ZoneOptions)
    })
    await step('the user checks the original zones file matched on its zone codes', async () => { r = await prepare(user, admin, zones, { check: true }) })
    await step('the preview reports the differing region as a change rather than a retained correction', () =>
      reports(r, ['1 row changes', '60 unchanged', '1 value changes', '0 rows keep your corrections']))
    await step('the user is warned that imports overwrite existing values without change history', () =>
      reports(r, ['does not keep change history', 'Imports overwrite existing values']))
  }, 60_000)

  // ---- A Choice by hand, refusals that say why, and importing again ----

  scenario('Many sections become a Choice by hand', async ({ admin }, step) => {
    const user = userEvent.setup()
    let rows: string[][] = []
    await step('a sheet whose Section column holds 12 different values', () => { rows = SECTIONS(12) })
    await step('the user imports it as a new table with Section switched to Choice', async () => {
      const wizard = await dropped(user, admin, rows)
      await wizard.setType('Section', 'Choice')
      await wizard.importAll()
    })
    await step('the new table holds every row', () => holdsEveryRow(admin, rows))
    await step('its Section column offers all 12 values', async () => {
      const meta = await admin.get<{ columns: { column_name: string; choices: string }[] }>(`/api/table/${enc(CHOICE_TABLE)}:meta`)
      expect(meta.columns.find((c) => c.column_name === 'section')!.choices.split('\n')).toHaveLength(12)
    })
  }, 60_000)

  scenario('A long list of options stays readable', async ({ admin }, step) => {
    const user = userEvent.setup()
    let wizard!: Wizard
    await step('a sheet whose Section column holds 12 different values', () => {})
    await step('the user switches Section to Choice in the import wizard', async () => {
      wizard = await dropped(user, admin, SECTIONS(12))
      await wizard.setType('Section', 'Choice')
    })
    await step('the wizard shows the first 8 options and says 4 more', () => {
      const text = wizard.optionsShown('Section')
      expect(text.split(', ')).toHaveLength(8)
      expect(text).toMatch(/\+4 more$/)
    })
  }, 60_000)

  scenario("Spaces around a value don't refuse its row", async ({ admin }, step) => {
    const user = userEvent.setup()
    let rows: string[][] = []
    await step('a sheet whose Zone column repeats Dairy and Fresh with spaces around them', () => {
      rows = [['Zone', 'Code'], ...Array.from({ length: 12 }, (_, i) => [i % 2 ? '" Fresh"' : '"Dairy "', `c${i}`])]
    })
    await step('the user imports it as a new table', async () => (await dropped(user, admin, rows)).importAll())
    await step('the new table holds every row', () => holdsEveryRow(admin, rows))
  }, 60_000)

  scenario('A column with a bad name is named', async ({ admin }, step) => {
    const user = userEvent.setup()
    let failure = ''
    await step('a sheet with a Zone column', () => {})
    await step('the user imports it as a new table with Zone\'s column name changed to "Bad Name"', async () => {
      const wizard = await dropped(user, admin, ZONE_SHEET)
      await wizard.setColumnName('Zone', 'Bad Name')
      failure = await wizard.importExpectingFailure()
    })
    await step('the import says the table failed because Column "Zone" must be snake_case', () =>
      expect(failure).toMatch(/failed — Invalid Table definition — Column .Zone.: column_name must be snake_case/))
  }, 60_000)

  scenario('Every row is refused', async ({ admin }, step) => {
    const user = userEvent.setup()
    let wizard!: Wizard
    let failure = ''
    await step('a sheet whose Zone column holds only words', () => {})
    await step('the user imports it as a new table with Zone switched to Int', async () => {
      wizard = await dropped(user, admin, ZONE_SHEET)
      await wizard.setType('Zone', 'Int')
      failure = await wizard.importExpectingFailure()
    })
    await step('the import says every row was refused', () => expect(failure).toMatch(/failed — all 2 rows were refused/))
    await step('the user switches Zone back to Data and imports again', async () => {
      await wizard.setType('Zone', 'Data')
      await user.click(screen.getByTestId('iw-import'))
    })
    await step('the new table holds every row', () => holdsEveryRow(admin, ZONE_SHEET))
  }, 60_000)

  scenario('No row landed', async ({ admin }, step) => {
    const user = userEvent.setup()
    let wizard!: Wizard
    let failure = ''
    await step('a sheet with a Zone column', () => {})
    await step('the connection drops while the import is sending its rows', () => {})
    await step('the user imports it as a new table', async () => {
      wizard = await dropped(user, admin, ZONE_SHEET)
      dropImport = async () => badGateway()
      failure = await wizard.importExpectingFailure()
    })
    await step('the import says the table failed', () => expect(failure).toMatch(/failed — Request failed \(502\)/))
    await step('the connection is back and the user imports again', async () => {
      dropImport = null
      await user.click(screen.getByTestId('iw-import'))
    })
    await step('the new table holds every row', () => holdsEveryRow(admin, ZONE_SHEET))
  }, 60_000)

  scenario('Some rows landed', async ({ admin }, step) => {
    const user = userEvent.setup()
    let wizard!: Wizard
    let failure = ''
    await step('a sheet with a Zone column', () => {})
    await step('the connection drops after one row has landed', () => {})
    await step('the user imports it as a new table', async () => {
      wizard = await dropped(user, admin, ZONE_SHEET)
      dropImport = async () => {
        await admin.post('/api/save_row', { table: CHOICE_TABLE, row: { zone: 'North', code: 'x' } })
        return badGateway()
      }
      failure = await wizard.importExpectingFailure()
    })
    await step('the import says the table failed', () => expect(failure).toMatch(/failed — Request failed \(502\)/))
    await step('the connection is back and the user imports again', async () => {
      dropImport = null
      await user.click(screen.getByTestId('iw-import'))
    })
    await step('the import says the table already holds 1 row and to delete it under Past imports', async () => {
      const text = await wizard.failureAfter(failure)
      expect(text).toMatch(/already holds 1 row from the attempt that stopped\. Delete it under Past imports/)
    })
    await step('the new table holds 1 row', async () => expect(await rowCount(admin)).toBe(1))
  }, 60_000)
})
