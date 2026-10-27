// Import wizard paths the merged web coverage report (ADR 0012) still showed
// red: the match key's companions (empty cells, unticking or remapping a
// column), a rehearsal or an import the server refuses because the Table went
// meanwhile, one target failing and "Fix it", a file that cannot be read, and
// the drop zone. Refusals are the real server's.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'
import { clearSession } from '../src/lib/import-session'

async function upload(csv: string, name = 'zones.csv') {
  const bytes = new TextEncoder().encode(csv).buffer
  const file = new File([bytes], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
  fireEvent.change(await screen.findByTestId('iw-file-input'), { target: { files: [file] } })
}

type Admin = Parameters<typeof renderApp>[1]

async function zoneTable(admin: Admin) {
  await admin.post('/api/table_def', {
    name: 'Iwr Zone',
    columns: [
      { column_name: 'zone_name', column_type: 'Data', label: 'Zone name', unique: true },
      { column_name: 'pop', column_type: 'Int', label: 'Pop' },
      { column_name: 'note', column_type: 'Data', label: 'Note' },
    ],
  })
  await admin.post('/api/save_row', { table: 'Iwr Zone', row: { zone_name: 'A', pop: 1 } })
}

async function openOnZones(admin: Admin) {
  clearSession()
  await zoneTable(admin)
  await renderApp('/featherbase/admin/import', admin)
  await upload('zone_name,pop,note\nA,5,x\nB,6,y\n')
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'), { timeout: 8000 })
}

test('with a match key, empty cells can be kept or cleared, and unticking or remapping a column keeps the key', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await user.click(screen.getByTestId('iw-empty-clear-0'))
  expect(screen.getByTestId('iw-empty-clear-0')).toBeChecked()
  await user.click(screen.getByTestId('iw-empty-keep-0'))
  expect(screen.getByTestId('iw-empty-keep-0')).toBeChecked()

  // The note column (row 2) is unticked, then mapped again: the key stays.
  await user.click(screen.getByTestId('iw-map-use-0-2'))
  expect(screen.getByTestId('iw-key-0')).toHaveValue('zone_name')
  await user.selectOptions(screen.getByTestId('iw-map-0-2'), 'note')
  expect(screen.getByTestId('iw-key-0')).toHaveValue('zone_name')
  clearSession()
})

test('a check or an import against a Table deleted meanwhile is refused with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await user.selectOptions(screen.getByTestId('iw-key-0'), 'zone_name')
  await admin.delete('/api/table_def/Iwr%20Zone')
  await user.click(screen.getByTestId('iw-check'))
  expect(await screen.findByTestId('iw-error')).toHaveTextContent(/^Table Iwr Zone was deleted by Administrator on /)
  await user.click(screen.getByTestId('iw-import'))
  await waitFor(() => expect(screen.getByTestId('iw-error')).toHaveTextContent(/^Table Iwr Zone was deleted by Administrator on /))
  clearSession()
})

test('a target the server refuses is named with the reason, and Fix it returns to it', async ({ admin }) => {
  const user = userEvent.setup()
  await openOnZones(admin)
  await admin.delete('/api/table_def/Iwr%20Zone')
  await user.click(screen.getByTestId('iw-import'))
  const failure = await screen.findByTestId('iw-failure-0', {}, { timeout: 8000 })
  expect(failure).toHaveTextContent(/^✗ Iwr Zone failed — Table Iwr Zone was deleted by Administrator on .+ Fix it$/)
  await user.click(within(failure).getByTestId('iw-failure-goto-0'))
  expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone')
  clearSession()
})

test('a file that cannot be read says why; the drop zone opens the picker and shows a drag over it', async ({ admin }) => {
  clearSession()
  await renderApp('/featherbase/admin/import', admin)
  const zone = await screen.findByTestId('iw-dropzone', {}, { timeout: 8000 })
  const picker = screen.getByTestId('iw-file-input')
  let opened = 0
  picker.addEventListener('click', () => opened++)
  fireEvent.click(zone)
  expect(opened).toBe(1)
  fireEvent.dragOver(zone)
  expect(zone.className).toMatch(/(^|\s)border-action(\s|$)/)
  fireEvent.dragLeave(zone)
  expect(zone.className).not.toMatch(/(^|\s)border-action(\s|$)/)
  await upload('\n\n', 'empty.csv')
  expect(await screen.findByTestId('iw-error')).toHaveTextContent('The file has no sheet with a header row and data')
  clearSession()
})

test('a long sheet previews its first fifty rows, then the failing rows past them after a gap', async ({ admin }) => {
  const user = userEvent.setup()
  clearSession()
  await zoneTable(admin)
  await renderApp('/featherbase/admin/import', admin)
  const lines = ['zone_name,pop,note']
  for (let n = 1; n <= 60; n++) lines.push(`Z${n},${n === 57 ? 'many' : n},x`)
  await upload(`${lines.join('\n')}\n`)
  await waitFor(() => expect(screen.getByTestId('iw-target-0')).toHaveValue('Iwr Zone'), { timeout: 8000 })
  await user.click(screen.getByTestId('iw-check'))
  // Excel numbering: the header is row 1, so data row 57 is row 58.
  expect(await screen.findByTestId('iw-preview-row-0-58', {}, { timeout: 8000 })).toBeInTheDocument()
  expect(screen.getByTestId('iw-preview-gap-0')).toHaveTextContent('… 9 more rows')
  expect(screen.queryByTestId('iw-preview-row-0-55')).not.toBeInTheDocument()
  clearSession()
})
