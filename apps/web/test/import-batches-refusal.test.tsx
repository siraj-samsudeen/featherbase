// #207: deleting the Tables an import created — backing out of the question,
// and a Table the server keeps because another Table points at it, named with
// the reason. Gaps the merged web coverage report (ADR 0012) showed; e2e
// covers the case where every Table goes. The import is made through the
// real import endpoint, the refusal is the server's.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, renderApp } from './pg-test'

test('Keep them backs out; a Table another Table points at is kept, with the reason', async ({ admin }) => {
  const user = userEvent.setup()
  await admin.post('/api/table_def', { name: 'Ibr Shelf', id_pattern: 'prompt', columns: [{ column_name: 'title', column_type: 'Data' }] })
  await admin.post('/api/table/Ibr%20Shelf:import', {
    rows: [{ row_id: 'shelf-1', title: 'top' }],
    context: { batch_id: 'ibr-batch', run_id: 'ibr-run', table_created: true },
  })
  await admin.post('/api/table_def', {
    name: 'Ibr Bin',
    columns: [{ column_name: 'shelf', column_type: 'Reference', reference_table: 'Ibr Shelf' }],
  })
  await admin.post('/api/save_row', { table: 'Ibr Bin', row: { shelf: 'shelf-1' } })

  await renderApp('/featherbase/admin/imports', admin)
  await user.click(await screen.findByTestId('ib-delete-ibr-batch', {}, { timeout: 8000 }))
  await user.click(screen.getByTestId('ib-cancel-ibr-batch'))
  expect(screen.queryByTestId('ib-confirm-ibr-batch')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('ib-delete-ibr-batch'))
  await user.click(screen.getByTestId('ib-confirm-go-ibr-batch'))
  const outcome = await screen.findByTestId('ib-outcome')
  expect(outcome).toHaveTextContent(/^Kept Ibr Shelf: .+\.$/)
  await waitFor(async () => expect(await admin.get('/api/table/Ibr%20Shelf:meta')).toMatchObject({ name: 'Ibr Shelf' }))
})
