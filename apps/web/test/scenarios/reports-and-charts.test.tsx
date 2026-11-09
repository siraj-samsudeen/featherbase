// reports-and-charts' fenced scenarios (#1070), rendered in jsdom against the
// real in-process server. Each test is one scenario of
// openspec/specs/reports-and-charts/spec.md, step by step: a script report's
// filters start at their declared values, and a value the user clears stays
// cleared.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, onTestFinished } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { registerScriptReport, type ScriptReport } from 'server/src/script-report'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'reports-and-charts')

// Expectations are independent of the reports' filter definitions and of what
// the server returns: the first request is never derived from the request or
// response under test.
const CHECK = { kind: 'small', quantity: 0, enabled: false, note: 'starting note', as_of: '2026-01-15', include_details: true }
const REVIEW = { kind: 'large', quantity: 7, enabled: true, note: 'review note', as_of: '2026-02-20', include_details: true }
type Defaults = typeof CHECK

// Real server-executed reports. Missing and falsy are deliberately different
// answers: defaults in execute() would conceal a page that forgets to send
// zero or false.
const stock = [
  { item: 'small zero off', kind: 'small', quantity: 0, enabled: false },
  { item: 'small two off', kind: 'small', quantity: 2, enabled: false },
  { item: 'large zero off', kind: 'large', quantity: 0, enabled: false },
  { item: 'large seven on', kind: 'large', quantity: 7, enabled: true },
]
function report(name: string, defaults: Defaults): ScriptReport {
  return {
    name,
    filters: [
      { column_name: 'kind', label: 'Kind', column_type: 'Choice', choices: '\nsmall\nlarge', default: defaults.kind },
      { column_name: 'quantity', label: 'Quantity', column_type: 'Int', default: defaults.quantity },
      { column_name: 'enabled', label: 'Enabled', column_type: 'Check', default: defaults.enabled },
      { column_name: 'note', label: 'Note', column_type: 'Data', default: defaults.note },
      { column_name: 'as_of', label: 'As of', column_type: 'Date', default: defaults.as_of },
      { column_name: 'include_details', label: 'Include details', column_type: 'Check', default: true },
    ],
    async execute(filters) {
      const present = (key: string) => Object.hasOwn(filters, key) && filters[key] !== ''
      const matches = stock.filter((row) =>
        (!present('kind') || row.kind === filters.kind) &&
        (!present('quantity') || row.quantity === Number(filters.quantity)) &&
        (!present('enabled') || row.enabled === filters.enabled))
      return {
        columns: ['items', 'quantity_received', 'enabled_received', 'note', 'as_of', 'include_details'],
        rows: [{
          items: matches.map((row) => row.item).join(', '),
          quantity_received: present('quantity') ? String(filters.quantity) : 'MISSING',
          enabled_received: present('enabled') ? String(filters.enabled) : 'MISSING',
          note: present('note') ? String(filters.note) : 'MISSING',
          as_of: present('as_of') ? String(filters.as_of) : 'MISSING',
          include_details: present('include_details') ? String(filters.include_details) : 'MISSING',
        }],
      }
    },
  }
}
// The registry is process-global with no unregister; the names are unique to this file.
registerScriptReport(report('issue778-stock-check', { ...CHECK }))
registerScriptReport(report('issue778-stock-review', { ...REVIEW }))

type Answer = { request: { report: string; filters: Record<string, unknown> }; result: { columns: string[]; rows: Record<string, string>[] } }

/** Every run_script_report the page sends, with the server's answer. */
function recordAnswers(): Answer[] {
  const answers: Answer[] = []
  const bridged = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await bridged(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.split('?')[0]!.endsWith('/api/run_script_report') && init?.method === 'POST') {
      expect(res.status, await res.clone().text()).toBe(200)
      answers.push({ request: JSON.parse(String(init.body)), result: await res.clone().json() })
    }
    return res
  }) as typeof fetch
  onTestFinished(() => { globalThis.fetch = bridged })
  return answers
}

async function install(admin: TestClient) {
  for (const [name, script, expected] of [['Stock Check', 'issue778-stock-check', CHECK], ['Stock Review', 'issue778-stock-review', REVIEW]] as const) {
    await admin.post('/api/save_row', { table: 'Report', row: { row_id: name, ref_table: 'Person', report_type: 'Script Report', report_script: script } })
    const meta = await admin.get<{ script: string; filters: { column_name: string; default: unknown }[] }>(`/api/script_report/${encodeURIComponent(name)}`)
    expect(meta.script).toBe(script)
    expect(Object.fromEntries(meta.filters.map((filter) => [filter.column_name, filter.default]))).toEqual(expected)
  }
  await admin.post('/api/save_row', {
    table: 'Home Page',
    row: {
      row_id: 'issue778-reports', label: 'Issue 778 reports',
      shortcuts: ['Stock Check', 'Stock Review'].map((name) => ({
        label: name, type: 'url', link_to: `/featherbase/admin/script-report/${encodeURIComponent(name)}`,
      })),
    },
  })
}

const filter = (name: string) => screen.getByTestId(`sr-filter-${name}`) as HTMLInputElement

/** Waits for the answer to `name` that `action` causes, and for the page to show it. */
async function answerFor(answers: Answer[], name: string, action: () => Promise<unknown>) {
  const before = answers.length
  await action()
  const answer = await waitFor(() => {
    const found = answers.slice(before).find((a) => a.request.report === name)
    expect(found, `an answer for ${name}`).toBeDefined()
    return found!
  }, { timeout: 8000 })
  await waitFor(() => {
    expect(screen.getByTestId('script-report-title')).toHaveTextContent(name)
    expect(screen.getByTestId('script-report-run')).toHaveTextContent(/^Run$/)
    expect(screen.getByTestId('script-report-rows')).toBeInTheDocument()
  }, { timeout: 8000 })
  return answer
}

async function expectAnswer(answer: Answer, row: Record<string, string>) {
  expect(answer.result.rows, 'real executed report answer').toEqual([row])
  await waitFor(() =>
    expect([...screen.getByTestId('script-report-rows').querySelectorAll('tr')].map((tr) => tr.textContent), 'rendered report answer')
      .toEqual([answer.result.columns.map((column) => row[column]).join('')]))
}

async function expectStarting(answer: Answer, expected: Defaults, items: string) {
  const filters = answer.request.filters
  // Form controls may send numbers as strings; presence and value must still
  // be checked, not collapsed via truthiness or a fallback default.
  expect(Object.hasOwn(filters, 'quantity'), 'first request must explicitly send quantity').toBe(true)
  expect({ ...filters, quantity: Number(filters.quantity) }, 'first automatic request uses declared defaults').toEqual(expected)
  for (const key of ['kind', 'quantity', 'note', 'as_of'] as const) expect(filter(key).value, `${key} control`).toBe(String(expected[key]))
  for (const key of ['enabled', 'include_details'] as const) expect(filter(key).checked, `${key} control`).toBe(expected[key])
  await expectAnswer(answer, {
    items, quantity_received: String(expected.quantity), enabled_received: String(expected.enabled),
    note: expected.note, as_of: expected.as_of, include_details: 'true',
  })
}

async function openCheck(admin: TestClient, answers: Answer[]) {
  await renderApp('/featherbase/admin/home/issue778-reports', admin)
  const shortcut = await screen.findByTestId('shortcut-Stock Check', {}, { timeout: 8000 })
  return answerFor(answers, 'Stock Check', () => userEvent.click(shortcut))
}

describe('reports-and-charts', () => {
  scenario('The first answer uses the starting values', async ({ admin }, step) => {
    const answers = recordAnswers()
    let first: Answer
    await step('the Stock Check script report starts with kind "small", quantity zero, enabled false and note "starting note"', () => install(admin))
    await step('the user opens Stock Check', async () => {
      first = await openCheck(admin, answers)
    })
    await step('its filters and first answer use those starting values', () => expectStarting(first, CHECK, 'small zero off'))
  })

  scenario('Cleared values stay cleared', async ({ admin }, step) => {
    const user = userEvent.setup()
    const answers = recordAnswers()
    let rerun: Answer
    const UNCONSTRAINED = 'small zero off, small two off, large zero off'
    await step('the user has opened Stock Check with its starting values', async () => {
      await install(admin)
      await openCheck(admin, answers)
    })
    await step('the user clears the kind and quantity and changes the note to "my choice"', async () => {
      await user.selectOptions(filter('kind'), '')
      await user.clear(filter('quantity'))
      await user.clear(filter('note'))
      await user.type(filter('note'), 'my choice')
    })
    await step('the user runs Stock Check again', async () => {
      rerun = await answerFor(answers, 'Stock Check', () => user.click(screen.getByTestId('script-report-run')))
    })
    await step('kind and quantity stay empty and no longer constrain the answer', () => {
      for (const key of ['kind', 'quantity']) {
        expect(filter(key).value, `${key} stays cleared`).toBe('')
        expect(!Object.hasOwn(rerun.request.filters, key) || rerun.request.filters[key] === '', `${key} is not restored in request`).toBe(true)
      }
      expect(rerun.result.rows[0]!.quantity_received).toBe('MISSING')
      expect(rerun.result.rows[0]!.items).toBe(UNCONSTRAINED)
    })
    await step('the answer uses note "my choice" rather than "starting note"', async () => {
      expect(filter('note').value).toBe('my choice')
      expect(rerun.request.filters.note).toBe('my choice')
      await expectAnswer(rerun, {
        items: UNCONSTRAINED, quantity_received: 'MISSING',
        enabled_received: 'false', note: 'my choice', as_of: '2026-01-15', include_details: 'true',
      })
    })
  })

  scenario('Another report has its own starting values', async ({ admin }, step) => {
    const answers = recordAnswers()
    let review: Answer
    await step('the user has opened Stock Check with its starting values', async () => {
      await install(admin)
      await openCheck(admin, answers)
    })
    await step('the user opens Stock Review which starts with kind "large"', async () => {
      fireEvent.change(filter('note'), { target: { value: 'edited check note' } })
      const marker = crypto.randomUUID()
      ;(window as unknown as { issue778Document: string }).issue778Document = marker
      await userEvent.click(screen.getByTestId('home-page-link-issue778-reports'))
      const shortcut = await screen.findByTestId('shortcut-Stock Review', {}, { timeout: 8000 })
      review = await answerFor(answers, 'Stock Review', () => userEvent.click(shortcut))
      expect((window as unknown as { issue778Document: string }).issue778Document, 'Report navigation must retain the SPA document').toBe(marker)
    })
    await step("Stock Review's filters and first answer use its own starting values", () => expectStarting(review, REVIEW, 'large seven on'))
  })
})
