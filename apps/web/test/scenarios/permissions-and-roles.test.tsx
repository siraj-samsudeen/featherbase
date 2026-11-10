// permissions-and-roles' fenced scenarios (#1070), rendered in jsdom against
// the real in-process server. Each test is one scenario of
// openspec/specs/permissions-and-roles/spec.md, step by step.
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, byTestId, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'permissions-and-roles')

const QUOTES = 'Grant Quote'
const ROLE = 'Grant Quote Title Editor'
const QUOTE = { row_id: 'Q-1', quote_title: 'Steel shelf', unit_cost: 120 }

describe('permissions-and-roles', () => {
  scenario('A detail that may be read but not changed', async ({ admin, createUser, seed }, step) => {
    let person: TestClient
    let session!: Session
    await step("a role may read a quote's title and unit cost but may change only its title", async () => {
      await admin.post('/api/table_def', {
        name: QUOTES,
        columns: [
          { column_name: 'quote_title', label: 'Title', column_type: 'Data', in_list_view: true },
          { column_name: 'unit_cost', label: 'Unit cost', column_type: 'Float' },
        ],
      })
      await admin.post(`/api/table/${encodeURIComponent(QUOTES)}`, QUOTE)
      await seed('Role', { row_id: ROLE })
      const meta = await admin.get<{ columns: { column_name: string; row_id: string }[] }>(`/api/table/Table/${encodeURIComponent(QUOTES)}`)
      const title = meta.columns.find((column) => column.column_name === 'quote_title')!
      await seed('Permission', { ref_table: QUOTES, role: ROLE, operation: 'read' })
      await seed('Permission', { ref_table: QUOTES, role: ROLE, operation: 'update', column_rule: 'listed', columns: [{ target_column: title.row_id }] })
    })
    await step('the user holds that role', async () => {
      person = await createUser({ roles: [ROLE] })
    })
    await step('the user changes the title and the unit cost of the quote "Q-1" and saves', async () => {
      ;({ session } = await renderSession('/featherbase/admin/table/grant-quote/row/Q-1', person))
      await session
        .assertValue('Title', 'Steel shelf')
        .fillIn('Title', 'Steel shelf, two bays')
        .fillIn('Unit cost', 95)
        .clickButton('Save')
    })
    await step('the save is refused', () =>
      session.within(byTestId('form-banner'), (banner) => banner.assertText('permission').refuteText('Saved')))
    await step('the quote "Q-1" keeps its old title and unit cost', async () => {
      const stored = await admin.get<{ quote_title: string; unit_cost: number }>(`/api/table/${encodeURIComponent(QUOTES)}/Q-1`)
      expect(stored.quote_title).toBe(QUOTE.quote_title)
      expect(Number(stored.unit_cost)).toBe(QUOTE.unit_cost)
    })
  })
})
