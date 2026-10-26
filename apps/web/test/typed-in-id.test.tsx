// naming-and-numbering: "Choose how new rows are named" — one of the choices
// is a name typed in by whoever creates the row. The generic form is the only
// place a person creates a row, so that choice has to be usable from it.

import { screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { describe } from 'vitest'
import { test, expect, renderApp } from './pg-test'

const DT = 'Typed Id Shelf'

describe('Choose how new rows are named', () => {
  // SPEC: Choose how new rows are named — suspected defect, see report. The
  // form drops any row id on a new row and offers no place to type one, so a
  // Table named "by whoever creates the row" refuses every save from the form
  // ("requires a Row ID").
  test.fails('a row in a typed-in-name Table can be created from the form', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: DT,
      id_pattern: 'prompt',
      columns: [{ column_name: 'title', column_type: 'Data', label: 'Title' }],
    })
    await renderApp(`/featherbase/admin/${encodeURIComponent(DT)}/new`, admin)
    await screen.findByTestId('form-view')

    const idInput = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-field=row_id]')
      expect(el).not.toBeNull()
      return el as HTMLInputElement
    })
    fireEvent.change(idInput, { target: { value: 'SHELF-A' } })
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field=title]')!, {
      target: { value: 'Top shelf' },
    })
    ;(await screen.findByTestId('form-save')).click()

    await waitFor(async () => {
      const row = (await admin.get(`/api/table/${encodeURIComponent(DT)}/SHELF-A`)) as { title: string }
      expect(row.title).toBe('Top shelf')
    })
  })
})
