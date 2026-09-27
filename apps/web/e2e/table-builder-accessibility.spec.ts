import { test, expect } from './fixtures'

// This is a deliberate deep link: the contract under test is the builder's
// semantic control interface, while table-builder.spec.ts proves navigation.
test('#294: table builder controls expose their purpose and column context', async ({ session }) => {
  await session
    .visit('/admin/new-table')
    .assertHas('[data-testid="table-builder"]')
    .fillIn('Table name', 'Accessible inventory')
    .fillIn('Module', 'Custom')
    .clickButton('+ Add column')
    .fillIn('Column 1 field label', 'Item')
    .fillIn('Column 1 database name', 'item')
    .selectOption('Column 1 type', 'Choice')
    .fillIn('Column 1 details', 'Small, Medium')
    .check('Column 1 required')
    .check('Column 1 show in list')
    .fillIn('Column 2 field label', 'Warehouse')
    .fillIn('Column 2 database name', 'warehouse')
    .selectOption('Column 2 type', 'Data')
    .check('Column 2 show in list')

  await session.step('grid rows expose each numbered column as their native row name', async ({ page }) => {
    await expect(page.getByRole('row', { name: 'Column 1', exact: true })).toBeVisible()
    await expect(page.getByRole('row', { name: 'Column 2', exact: true })).toBeVisible()
  })

  await session
    .clickButton('Remove column 2')
    .assertHas('[data-columnrow]', { count: 1 })
    .clickButton('+ Add column')
    .selectOption('Row naming method', 'Series with prefix')
    .fillIn('Series prefix', 'INV-')
    .selectOption('Series digits', '0001, 0002…')
    .clickButton('Cards')

  await session.step('cards expose each numbered column as a named group', async ({ page }) => {
    await expect(page.getByRole('group', { name: 'Column 1', exact: true })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Column 2', exact: true })).toBeVisible()
  })

  await session
    .fillIn('Column 1 field label', 'Card item')
    .clickButton('Column 1 type Pick from a list')

  await session.step('the choice input name composes column context with its visible label', async ({ page }) => {
    await expect(page.getByRole('textbox', {
      name: 'Column 1 The options, comma-separated', exact: true,
    })).toBeVisible()
  })

  await session
    .within('[data-testid="dt-card-0"]', (card) =>
      card.fillIn('The options, comma-separated', 'Single, Case'),
    )
    .uncheck('Column 1 required')
    .fillIn('Column 2 field label', 'Card warehouse')
    .clickButton('Column 2 type Link to another table')

  await session.step('the linked-table name composes column context with its visible label', async ({ page }) => {
    await expect(page.getByRole('combobox', {
      name: 'Column 2 Which table does it link to?', exact: true,
    })).toBeVisible()
  })

  await session
    .within('[data-testid="dt-card-1"]', (card) =>
      card.selectOption('Which table does it link to?', 'Choose a table…'),
    )
    .check('Column 2 required')
    .clickButton('Remove column 2')
    .refuteHas('[data-testid="dt-card-1"]')
})
