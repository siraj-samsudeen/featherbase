import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

for (const override of [null, 'ORIGINAL-.###', 'CUSTOM-.##']) {
  // #855: with no choice made, the new Table is numbered 1, 2, 3 whatever it
  // is renamed to; a series the user chose survives the rename.
  test(`IMP-R6 #114 renamed Table keeps its naming choice: ${override ?? 'none (numbers)'}`, async ({ admin }) => {
    clearSession()
    await renderApp('/featherbase/admin/import', admin)
    const bytes = new TextEncoder().encode('Title\nalpha\nbeta\n').buffer
    const file = new File([bytes], 'original.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
    fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
    const name = await screen.findByTestId('iw-new-name-0')
    const user = userEvent.setup()
    if (override !== null) {
      fireEvent.change(screen.getByTestId('iw-0-naming'), { target: { value: 'series' } })
      // Explicitly selecting even the SAME digit count invokes onChange and
      // establishes an override equal to the derived series.
      if (override.startsWith('CUSTOM')) fireEvent.change(screen.getByTestId('iw-0-naming-prefix'), { target: { value: 'CUSTOM-' } })
      fireEvent.change(screen.getByTestId('iw-0-naming-digits'), { target: { value: override.endsWith('.##') ? '2' : '3' } })
    }
    await user.clear(name)
    await user.type(name, 'Renamed Import')
    const pattern = override ?? 'integer'
    if (override === null) expect(screen.getByTestId('iw-0-naming')).toHaveValue('integer')
    else expect(screen.getByTestId('iw-0-naming-prefix')).toHaveValue(pattern.split('.')[0])
    await user.click(screen.getByTestId('iw-import'))
    await screen.findByTestId('list-view')
    await waitFor(async () => {
      const meta = await admin.get<{ id_pattern: string }>('/api/table/Renamed%20Import:meta')
      expect(meta.id_pattern).toBe(pattern)
      const rows = await admin.get<{ data: { row_id: string }[] }>('/api/table/Renamed%20Import')
      expect(rows.data).toHaveLength(2)
      if (override === null) expect(rows.data.map((r) => r.row_id).sort()).toEqual(['1', '2'])
      else for (const row of rows.data) expect(row.row_id.startsWith(pattern.split('.')[0])).toBe(true)
    })
    clearSession()
  })
}
