// naming-and-numbering's scenarios a person reads on screen (#1070). Each
// test is one fenced scenario of
// openspec/specs/naming-and-numbering/spec.md, step by step, rendered in
// jsdom against the real in-process server; the rest are in
// apps/server/test/scenarios/.
import { tableSlug } from 'shared'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderApp } from '../pg-test'

const scenario = scenarioFor(test, 'naming-and-numbering')
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-field=${name}]`) as HTMLInputElement

describe('naming-and-numbering', () => {
  scenario('The builder shows the numbering before the table is made', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user is building a table "Plant"', async () => {
      await renderApp('/featherbase/admin/new-table', admin)
      await screen.findByTestId('table-builder')
      await user.type(screen.getByTestId('dt-name'), 'Plant')
    })
    await step('the builder says its rows will be numbered 1, 2, 3', () =>
      expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('Rows will be numbered 1, 2, 3'))
  })

  scenario('The builder shows the shape of the id', async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('the user is building a table "Plant" with a column "Plant Code"', async () => {
      await renderApp('/featherbase/admin/new-table', admin)
      await screen.findByTestId('table-builder')
      await user.type(screen.getByTestId('dt-name'), 'Plant')
      await user.click(screen.getByTestId('dt-paste-open'))
      await user.click(screen.getByTestId('dt-paste-text'))
      await user.paste('Plant Code')
      await user.click(screen.getByTestId('dt-paste-build'))
    })
    await step('the user names its rows "PLANT-" followed by the plant code', async () => {
      await user.selectOptions(screen.getByTestId('dt-naming'), 'field:plant_code')
      await user.type(screen.getByTestId('dt-naming-prefix'), 'PLANT-')
    })
    await step('the builder says ids look like PLANT-‹Plant Code›', () =>
      expect(screen.getByTestId('dt-naming-preview')).toHaveTextContent('Ids look like PLANT-‹Plant Code›'))
  })

  scenario("A plant's code is corrected", async ({ admin }, step) => {
    const user = userEvent.setup()
    await step('plant PLANT-8151 is open', async () => {
      await admin.post('/api/table_def', {
        name: 'Plant',
        id_pattern: 'PLANT-{plant_code}',
        columns: [
          { column_name: 'plant_code', column_type: 'Data', label: 'Plant Code' },
          { column_name: 'city', column_type: 'Data', label: 'City' },
        ],
      })
      await admin.post('/api/save_row', { table: 'Plant', row: { plant_code: '8151', city: 'Chennai' } })
      await renderApp(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Plant'))}/row/PLANT-8151`, admin)
      await waitFor(() => expect(field('plant_code')).toHaveValue('8151'), { timeout: 8000 })
    })
    await step('the user changes its plant code to 8159', async () => {
      await user.clear(field('plant_code'))
      await user.type(field('plant_code'), '8159')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(async () =>
        expect(((await admin.get(`/api/table/Plant/PLANT-8151`)) as { plant_code: string }).plant_code).toBe('8159'))
    })
    await step('the plant keeps the id PLANT-8151', async () => {
      expect(screen.getByTestId('form-id-out-of-step')).toHaveTextContent('This row keeps the id PLANT-8151.')
    })
    await step('the form offers Rename to PLANT-8159', async () => {
      await user.click(screen.getByTestId('form-id-rename'))
      expect(screen.getByTestId('rename-input')).toHaveValue('PLANT-8159')
    })
  })
})
