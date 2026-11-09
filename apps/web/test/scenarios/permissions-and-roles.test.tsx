// permissions-and-roles' fenced scenarios (#1070), rendered in jsdom against
// the real in-process server. Each test is one scenario of
// openspec/specs/permissions-and-roles/spec.md, step by step.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import type { TestClient } from 'feather-testing-postgres'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'permissions-and-roles')
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

const QUOTES = 'Grant Quote'
const ROLE = 'Grant Quote Title Editor'
const QUOTE = { row_id: 'Q-1', quote_title: 'Steel shelf', unit_cost: 120 }

describe('permissions-and-roles', () => {
  scenario('A detail that may be read but not changed', async ({ admin, createUser }, step) => {
    const user = userEvent.setup()
    let person: TestClient
    await step("a role may read a quote's title and unit cost but may change only its title", async () => {
      await admin.post('/api/table_def', {
        name: QUOTES,
        columns: [
          { column_name: 'quote_title', label: 'Title', column_type: 'Data', in_list_view: true },
          { column_name: 'unit_cost', label: 'Unit cost', column_type: 'Float' },
        ],
      })
      await admin.post(`/api/table/${encodeURIComponent(QUOTES)}`, QUOTE)
      await admin.post('/api/save_row', { table: 'Role', row: { row_id: ROLE } })
      const meta = await admin.get<{ columns: { column_name: string; row_id: string }[] }>(`/api/table/Table/${encodeURIComponent(QUOTES)}`)
      const title = meta.columns.find((column) => column.column_name === 'quote_title')!
      await admin.post('/api/save_row', { table: 'Permission', row: { ref_table: QUOTES, role: ROLE, operation: 'read' } })
      await admin.post('/api/save_row', {
        table: 'Permission',
        row: { ref_table: QUOTES, role: ROLE, operation: 'update', column_rule: 'listed', columns: [{ target_column: title.row_id }] },
      })
    })
    await step('the user holds that role', async () => {
      person = await createUser({ roles: [ROLE] })
    })
    await step('the user changes the title and the unit cost of the quote "Q-1" and saves', async () => {
      await renderApp('/featherbase/admin/table/grant-quote/row/Q-1', person)
      await waitFor(() => expect(field('quote_title')).toHaveValue('Steel shelf'), { timeout: 8000 })
      await user.clear(field('quote_title'))
      await user.type(field('quote_title'), 'Steel shelf, two bays')
      await user.clear(field('unit_cost'))
      await user.type(field('unit_cost'), '95')
      await user.click(screen.getByTestId('form-save'))
      await screen.findByTestId('form-banner', {}, { timeout: 8000 })
    })
    await step('the save is refused', async () => {
      const banner = screen.getByTestId('form-banner')
      await waitFor(() => expect(banner.textContent?.trim()).not.toBe(''))
      expect(banner.textContent?.trim()).not.toBe('Saved')
      expect(banner.textContent).toMatch(/permission/i)
    })
    await step('the quote "Q-1" keeps its old title and unit cost', async () => {
      const stored = await admin.get<{ quote_title: string; unit_cost: number }>(`/api/table/${encodeURIComponent(QUOTES)}/Q-1`)
      expect(stored.quote_title).toBe(QUOTE.quote_title)
      expect(Number(stored.unit_cost)).toBe(QUOTE.unit_cost)
    })
  })
})
