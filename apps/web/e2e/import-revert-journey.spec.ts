import { test, expect, adminToken, type APIRequestContext } from './fixtures'
import * as XLSX from 'xlsx'
import { deleteTableIfExists } from './cleanup'

// Spec 0005, RVT-J1: the browser walk, via the history strip (J1.1's second
// entry point — the wizard auto-navigates after a single-sheet import, so
// the realistic revert begins by coming BACK). A corrected file lands on a
// match key; a later import edits a row again; revert: rehearsal counts
// first, the edited row skipped and NAMED, the run's insert deleted, then
// the "revert these N anyway" escalation as a second explicit act.

const DT = 'Revert Journey Zones'

function xlsxOf(rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Zones')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

async function zonePops(request: APIRequestContext, headers: Record<string, string>) {
  const res = (await (
    await request.get(
      `/api/table/${encodeURIComponent(DT)}?fields=${encodeURIComponent(
        '["row_id","zone","pop"]',
      )}&limit_page_length=100`,
      { headers },
    )
  ).json()) as { data: { row_id: string; zone: string; pop: unknown }[] }
  return res.data
}

test('RVT-J1: revert the bad run from the history strip — rehearse, skip-the-edited, escalate', async ({
  page,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, DT)

  // Prior state (residue-shaped): a Table with seeded rows, outside any run.
  const created = await request.post('/api/table_def', {
    headers,
    data: {
      name: DT,
      columns: [
        { column_name: 'zone', label: 'Zone', column_type: 'Data', in_list_view: true },
        { column_name: 'pop', label: 'Pop', column_type: 'Int', in_list_view: true },
      ],
    },
  })
  expect(created.status()).toBe(201)
  await request.post(`/api/table/${encodeURIComponent(DT)}:import`, {
    headers,
    data: {
      rows: [
        { zone: 'Alpha', pop: 12000 },
        { zone: 'Bravo', pop: 8400 },
      ],
    },
  })

  await page.goto('/admin')

  // The run under test: upsert the corrected file through the wizard.
  await page.getByTestId('import-data-link').click()
  await page.getByTestId('iw-file-input').setInputFiles({
    name: 'corrected.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: xlsxOf([
      ['Zone', 'Pop'],
      ['Alpha', 13500],
      ['Charlie', 100],
    ]),
  })
  await expect(page.getByTestId('iw-target-0')).toHaveValue(DT)
  await page.getByTestId('iw-key-0').selectOption('zone')
  await expect(page.getByTestId('iw-preview-0')).toContainText('will be updated')
  await page.getByRole('button', { name: 'Import 2 rows' }).click()
  // The wizard auto-navigates to the Table's list (the ratified IMP/UPS walk).
  await expect(page).toHaveURL(new RegExp(`/admin/${encodeURIComponent(DT)}`))

  // Someone edits Alpha AFTER the run — another keyed import, realistically.
  await request.post(`/api/table/${encodeURIComponent(DT)}:import`, {
    headers,
    data: { key_column: 'zone', rows: [{ zone: 'Alpha', pop: 99999 }] },
  })
  const alphaName = (await zonePops(request, headers)).find((r) => r.zone === 'Alpha')!.row_id

  // J1.1: back to the wizard with the Table preselected — the history strip
  // lists the run; rehearse shows counts before anything commits, the
  // edited row named.
  await page.goto(`/admin/import?table=${encodeURIComponent(DT)}`)
  await expect(page.getByTestId('iw-run-history')).toBeVisible()
  await expect(page.getByTestId('iw-run-0')).toContainText('corrected.xlsx')
  await page.getByTestId('iw-revert-open-h0').click()
  const preview = page.getByTestId('iw-revert-preview-h0')
  await expect(preview).toContainText('delete 1 added rows')
  await expect(preview).toContainText(`${alphaName} (edited after this import)`)

  // J1.2: confirm. Charlie goes; Alpha stays edited, named in the report.
  await page.getByTestId('iw-revert-confirm-h0').click()
  const result = page.getByTestId('iw-revert-result-h0')
  await expect(result).toContainText('0 restored, 1 deleted')
  await expect(result).toContainText(`${alphaName} (edited after this import)`)

  // J1.3: the table agrees — Charlie gone, Bravo untouched, Alpha still 99999.
  const mid = await zonePops(request, headers)
  const midByZone = Object.fromEntries(mid.map((r) => [r.zone, Number(r.pop)]))
  expect(mid).toHaveLength(2)
  expect(midByZone.Alpha).toBe(99999)
  expect(midByZone.Bravo).toBe(8400)

  // J1.4: the escalation — a second, explicit act over the named row. The
  // restore returns Alpha to the RUN's before-value (12000), not 13500: the
  // version trail's before-values are the restore source.
  await page.getByTestId('iw-revert-override-h0').click()
  await expect(result).toContainText('1 restored')
  const after = await zonePops(request, headers)
  const byZone = Object.fromEntries(after.map((r) => [r.zone, Number(r.pop)]))
  expect(byZone.Alpha).toBe(12000)
  expect(byZone.Bravo).toBe(8400)

  // J1.5: the log records the revert.
  const logs = (await (
    await request.get(
      `/api/table/${encodeURIComponent('Import Log')}?fields=${encodeURIComponent(
        '["ref_table","reverted_at"]',
      )}&filters=${encodeURIComponent(JSON.stringify([['ref_table', '=', DT]]))}`,
      { headers },
    )
  ).json()) as { data: { reverted_at: unknown }[] }
  expect(logs.data.some((l) => l.reverted_at)).toBe(true)

  // Teardown — self-cleaning via table deletion (spec 0003).
  const del = await request.delete(`/api/table_def/${encodeURIComponent(DT)}`, { headers })
  expect(del.status()).toBe(200)
})
