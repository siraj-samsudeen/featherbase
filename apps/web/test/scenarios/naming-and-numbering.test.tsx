// naming-and-numbering's scenarios a person reads on screen (#1070). Each
// test is one fenced scenario of
// openspec/specs/naming-and-numbering/spec.md, step by step, rendered in
// jsdom against the real in-process server; the rest are in
// apps/server/test/scenarios/.
import { tableSlug } from 'shared'
import { screen } from '@testing-library/react'
import { describe } from 'vitest'
import { scenarioFor } from 'server/test/scenario'
import { test, expect, renderSession, byTestId, inside, type Session } from '../pg-test'

const scenario = scenarioFor(test, 'naming-and-numbering')

describe('naming-and-numbering', () => {
  scenario('The builder shows the numbering before the table is made', async ({ admin }, step) => {
    let session!: Session
    await step('the user is building a table "Plant"', async () => {
      ;({ session } = await renderSession('/featherbase/admin/new-table', admin))
      await session.fillIn('Table name', 'Plant')
    })
    await step('the builder says its rows will be numbered 1, 2, 3', () =>
      session.within(byTestId('dt-naming-preview'), (preview) => preview.assertText('Rows will be numbered 1, 2, 3')))
  })

  scenario('The builder shows the shape of the id', async ({ admin }, step) => {
    let session!: Session
    await step('the user is building a table "Plant" with a column "Plant Code"', async () => {
      ;({ session } = await renderSession('/featherbase/admin/new-table', admin))
      await session
        .fillIn('Table name', 'Plant')
        .clickButton('Or paste the columns as a list')
        // The paste box has no label, and its placeholder is a three-line sample.
        .step('paste the column list "Plant Code"', async ({ user }) => {
          await user.click(screen.getByTestId('dt-paste-text'))
          await user.paste('Plant Code')
        })
        .clickButton('Add these columns')
    })
    await step('the user names its rows "PLANT-" followed by the plant code', () =>
      session
        // The naming select has no label for selectOption to find it by.
        .step('name rows by the column Plant Code', ({ user }) => user.selectOptions(screen.getByTestId('dt-naming'), 'field:plant_code'))
        .fillIn('Prefix, optional, e.g. PLANT-', 'PLANT-'))
    await step('the builder says ids look like PLANT-‹Plant Code›', () =>
      session.within(byTestId('dt-naming-preview'), (preview) => preview.assertText('Ids look like PLANT-‹Plant Code›')))
  })

  scenario("A plant's code is corrected", async ({ admin, seed }, step) => {
    let session!: Session
    await step('plant PLANT-8151 is open', async () => {
      await admin.post('/api/table_def', {
        name: 'Plant',
        id_pattern: 'PLANT-{plant_code}',
        columns: [
          { column_name: 'plant_code', column_type: 'Data', label: 'Plant Code' },
          { column_name: 'city', column_type: 'Data', label: 'City' },
        ],
      })
      await seed('Plant', { plant_code: '8151', city: 'Chennai' })
      ;({ session } = await renderSession(`/featherbase/admin/table/${encodeURIComponent(tableSlug('Plant'))}/row/PLANT-8151`, admin))
      await session.assertValue('Plant Code', '8151')
    })
    await step('the user changes its plant code to 8159', async () => {
      await session
        .fillIn('Plant Code', '8159')
        .clickButton('Save')
        .until('the stored plant code is 8159', async () =>
          ((await admin.get(`/api/table/Plant/PLANT-8151`)) as { plant_code: string }).plant_code === '8159')
    })
    await step('the plant keeps the id PLANT-8151', () =>
      inside(session, 'form-id-out-of-step', (notice) => notice.assertText('This row keeps the id PLANT-8151.')))
    await step('the form offers Rename to PLANT-8159', async () => {
      await session.clickButton('Rename to PLANT-8159')
      // The rename box has no label or placeholder for assertValue to find it by.
      expect(screen.getByTestId('rename-input')).toHaveValue('PLANT-8159')
    })
  })
})
