// Featherbase, the base tour (#1070): from a messy workbook to an app you can
// navigate. One builder, Priya, who keeps the stores' asset register. She is a
// System Manager, not the Administrator who installed the instance.
//
// Steps the platform can't do yet are `gap` chapters naming #1071.
import type { Page } from '@playwright/test'
import { ensurePerson, expect, tour, type Person } from './tour'
import { assetsWorkbook, storesWorkbook, tNagarUpdate } from './data/workbooks'

const ROWS = Number(process.env.TOUR_ROWS ?? 120)
const PRIYA: Person = { user: 'priya@stores.example', password: 'tour-priya-pw', fullName: 'Priya Raman' }
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function dropFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.getByRole('link', { name: 'Import Data' }).first().click()
  await expect(page).toHaveURL(/\/admin\/import$/)
  await expect(page.getByTestId('iw-dropzone')).toBeVisible()
  await page.getByTestId('iw-file-input').setInputFiles({ name, mimeType: XLSX_TYPE, buffer })
  await expect(page.getByTestId('iw-file-name')).toContainText(name)
}

/** In the merged-sheets grid: declare two differently named file columns one. */
async function combine(page: Page, a: string, b: string, as: string): Promise<void> {
  const picks = page.getByRole('checkbox', { name: /^Combine / })
  const before = await picks.count()
  await page.getByRole('checkbox', { name: `Combine ${a}`, exact: true }).check()
  await page.getByRole('checkbox', { name: `Combine ${b}`, exact: true }).check()
  await page.getByTestId('iw-combine-name-0').fill(as)
  await page.getByTestId('iw-combine-go-0').click()
  await expect(picks).toHaveCount(before - 1)
  await expect(page.getByRole('checkbox', { name: `Combine ${as}`, exact: true })).toHaveCount(1)
}

/** The type of a column in the wizard's grid, found by its file column. */
async function setType(page: Page, fileColumn: string, type: string): Promise<void> {
  const row = page.getByTestId('iw-new-grid-0').locator('tbody tr[data-columnrow]').filter({ hasText: fileColumn }).first()
  await row.locator('[data-rowfield=column_type]').selectOption(type)
}

/** Open a Table from All tables, as someone who doesn't know its address would. */
async function openTable(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: 'All tables' }).first().click()
  await page.getByRole('link', { name: label, exact: true }).first().click()
  await expect(page.getByTestId('list-view')).toBeVisible()
}

async function openColumns(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Table administration' }).click()
  await page.getByRole('link', { name: 'Edit columns' }).click()
  await expect(page.getByTestId('column-editor')).toBeVisible()
}

async function filterEquals(page: Page, column: string, value: string): Promise<void> {
  if (!(await page.getByTestId('filter-field').isVisible())) await page.getByTestId('filter-toggle').click()
  await page.getByTestId('filter-field').selectOption(column)
  await page.getByTestId('filter-op').selectOption('=')
  const input = page.getByTestId('filter-value')
  if ((await input.evaluate((el) => el.tagName)) === 'SELECT') await input.selectOption(value)
  else await input.fill(value)
  await page.getByTestId('filter-add').click()
  await expect(page.getByTestId('filter-chip').last()).toContainText(value)
}

async function clearFilters(page: Page): Promise<void> {
  const chips = page.getByTestId('filter-chip')
  while ((await chips.count()) > 0) {
    const n = await chips.count()
    await chips.last().getByRole('button').click()
    await expect(chips).toHaveCount(n - 1)
  }
}

/**
 * Today's way to make a spelling uniform (#1071): filter to it, tick the
 * page, bulk-edit it, and repeat while a page of it is left.
 */
async function replaceEverywhere(page: Page, column: string, from: string, to: string): Promise<number> {
  await filterEquals(page, column, from)
  let rounds = 0
  const total = page.getByTestId('list-total')
  while (!/^\s*0 total/.test((await total.textContent()) ?? '')) {
    rounds++
    const before = (await total.textContent()) ?? ''
    await page.getByRole('checkbox', { name: 'Select all rows' }).check()
    await page.getByTestId('bulk-edit-field').selectOption(column)
    await page.getByTestId('bulk-edit-value').fill(to)
    await page.getByTestId('bulk-edit-apply').click()
    await expect(page.getByTestId('bulk-bar')).toHaveCount(0)
    await expect(total).not.toHaveText(before)
    if (rounds > 20) throw new Error(`"${from}" is still there after ${rounds} rounds`)
  }
  await clearFilters(page)
  return rounds
}

tour('Featherbase: from a messy workbook to an app you can navigate', async ({ story, request }) => {
  await ensurePerson(request, { ...PRIYA, roles: ['System Manager'] })
  const s = await story(PRIYA)
  const page = () => s.page

  await s.chapter('Bring in the store list', 60_000, async () => {
    await s.step("Priya drops head office's store list onto Import Data", async () => {
      await dropFile(page(), 'stores.xlsx', storesWorkbook())
    })
    await s.step('Each store is known by its name, so its name becomes its id', async () => {
      await expect(page().getByTestId('iw-new-name-0')).toHaveValue('Stores')
      await page().getByTestId(/-naming$/).first().selectOption('field:store')
    })
    await s.step('Three stores make a new Table, Stores, which opens straight away', async () => {
      await page().getByTestId('iw-import').click()
      await expect(page()).toHaveURL(/\/admin\/table\/[^/]+$/)
      await expect(page().getByTestId('list-total')).toContainText('3 total')
    })
  }, 'Head office keeps one clean list of stores.')

  await s.chapter('Bring in three stores\' asset sheets', 120_000, async () => {
    await s.step('The asset register has one sheet per store, each typed up differently', async () => {
      await dropFile(page(), 'asset register.xlsx', assetsWorkbook(ROWS))
      await expect(page().getByTestId('iw-overview')).toContainText('Tag No')
      await expect(page().getByTestId('iw-overview')).toContainText('store name')
    })
    await s.step('All three sheets go into one Table, Assets', async () => {
      await page().getByTestId('iw-ov-master').check()
      await page().getByTestId('iw-ov-mode-merge').check()
      await page().getByTestId('iw-ov-merge-name').fill('Assets')
      await page().getByTestId('iw-ov-continue').click()
      await expect(page().getByTestId('iw-new-grid-0')).toBeVisible()
    })
    await s.step('Spellings that differ only in case and spaces are matched for her', async () => {
      // "asset tag", "floor " and "Purchase date" fold into the first sheet's names.
      await expect(page().getByRole('checkbox', { name: 'Combine asset tag', exact: true })).toHaveCount(0)
    })
    await s.step('The names a person would match, she matches', async () => {
      await combine(page(), 'Asset Tag', 'Tag No', 'Asset Tag')
      await combine(page(), 'Item', 'Item Name', 'Item')
      await combine(page(), 'Store', 'Branch', 'Store')
      await combine(page(), 'Store', 'Store Name', 'Store')
      await combine(page(), 'Room', 'Section', 'Section')
      await combine(page(), 'Purchase Date', 'Bought On', 'Purchase Date')
      await combine(page(), 'Cost', 'Cost (Rs)', 'Cost')
    })
    await s.step('Each asset is known by its tag; its cost is money; its store stays text until it is tidy', async () => {
      await page().getByTestId(/-naming$/).first().selectOption('field:asset_tag')
      await setType(page(), 'Cost', 'Currency')
      // A few distinct values are offered as a Choice; only text can later become a link.
      await setType(page(), 'Store', 'Data')
    })
    await s.step(`All ${3 * ROWS} assets go in`, async () => {
      await page().getByTestId('iw-import').click()
      await expect(page().getByTestId('iw-result-0')).toContainText(`Imported ${3 * ROWS} rows`)
    })
  }, 'Anna Nagar, T Nagar and Velachery each keep their own sheet.')

  await s.gap(
    'keep which sheet a row came from',
    1071,
    'When each sheet is a store, merging the sheets loses the store. These sheets happen to carry a store column; most real ones do not.',
  )

  await s.chapter('Tidy the columns', 60_000, async () => {
    await s.step('Section is called Department at these stores', async () => {
      await openTable(page(), 'Assets')
      await openColumns(page())
      const row = page().getByTestId('ce-row-section')
      await row.getByRole('button', { name: 'Rename section' }).click()
      await row.getByLabel('New name for section').fill('department')
      await row.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(page().getByTestId('ce-row-department')).toBeVisible()
    })
  })
  await s.gap('change a column\'s type after import', 1071, 'A column\'s type is fixed once the Table exists; only text-to-link and back can change.')
  await s.gap('merge two columns', 1071, 'Floor and Department could be one Location column, but columns combine only inside the import wizard.')

  await s.chapter('Make the floors say the same thing', 120_000, async () => {
    await s.step('T Nagar wrote "FF" and "1st Floor" for First Floor', async () => {
      await openTable(page(), 'Assets')
      await replaceEverywhere(page(), 'floor', 'FF', 'First Floor')
      await replaceEverywhere(page(), 'floor', '1st Floor', 'First Floor')
    })
    await s.step('and "GF" for Ground Floor', async () => {
      await replaceEverywhere(page(), 'floor', 'GF', 'Ground Floor')
    })
  }, 'Today: filter to one spelling, tick a page, bulk-edit, repeat.')
  await s.gap(
    'make every spelling of a value the same in one step',
    1071,
    'One rule such as "GF, ground floor, 1st Floor → the right name", kept for the next import too. Bulk edit acts on one page of 20 rows at a time.',
  )

  await s.chapter('Link every asset to its store', 120_000, async () => {
    await s.step('Turning Store into a link to Stores is refused, and the refusal names the odd spelling', async () => {
      await openColumns(page())
      const row = page().getByTestId('ce-row-store')
      await row.getByRole('button', { name: /Turn .* into a link/ }).click()
      await row.getByLabel('Table store links to').selectOption('Stores')
      await page().getByTestId('ce-link-go-store').click()
      await expect(page().getByTestId('ce-link-error-store')).toContainText('T. Nagar')
    })
    await s.step('"T. Nagar" becomes "T Nagar"', async () => {
      await openTable(page(), 'Assets')
      await replaceEverywhere(page(), 'store', 'T. Nagar', 'T Nagar')
    })
    await s.step('Now every asset links to its store', async () => {
      await openColumns(page())
      const row = page().getByTestId('ce-row-store')
      await row.getByRole('button', { name: /Turn .* into a link/ }).click()
      await row.getByLabel('Table store links to').selectOption('Stores')
      await page().getByTestId('ce-link-go-store').click()
      await expect(page().getByTestId('ce-saved')).toBeVisible()
    })
  }, 'A link only takes values that name a real store.')

  const update = tNagarUpdate(ROWS)
  await s.chapter('Bring in next month\'s sheet', 90_000, async () => {
    await s.step('T Nagar sends its whole sheet again: two prices fixed, three new assets', async () => {
      await dropFile(page(), 't nagar update.xlsx', update.file)
    })
    await s.step('It goes into Assets, matched on Asset Tag: nothing is duplicated', async () => {
      await page().getByTestId('iw-target-0').click()
      await page().getByTestId('iw-target-opt-0-Assets').click()
      await page().getByTestId('iw-key-0').selectOption('asset_tag')
      await expect(page().getByTestId('iw-preview-0')).toContainText(`2 rows change · ${ROWS - 2} unchanged · 2 added`)
    })
    await s.step('The sheet still says "FF" and "T. Nagar", but her clean-up is kept', async () => {
      await expect(page().getByTestId('iw-preview-0')).toContainText('rows keep your corrections')
    })
    await s.step('Before anything is written, one new asset is refused: its store is spelt "T. Nagar"', async () => {
      await expect(page().getByTestId('iw-preview-0')).toContainText('1 refused')
      await page().getByTestId('iw-check').click()
      await expect(page().getByTestId('iw-check-0')).toContainText('T. Nagar')
    })
    await s.step('She imports the rest; the refused row says why', async () => {
      await page().getByTestId('iw-import').click()
      await expect(page().getByTestId('iw-result-0')).toContainText('added 2 rows')
      await expect(page().getByTestId('iw-result-0')).toContainText('T. Nagar does not exist')
    })
  })
  await s.gap(
    'remember that "T. Nagar" means T Nagar',
    1071,
    'An alias kept with the link, so next month\'s sheet links by itself instead of refusing the row.',
  )

  await s.chapter('Change her mind', 60_000, async () => {
    await s.step('The import history holds the run; undoing it is previewed first', async () => {
      await openTable(page(), 'Assets')
      await page().getByRole('button', { name: 'List actions' }).click()
      await page().getByTestId('open-import').click()
      await expect(page().getByTestId('iw-run-history')).toBeVisible()
      const run = page().getByTestId(/^iw-run-\d+$/).filter({ hasText: 't nagar update.xlsx' })
      await expect(run).toHaveCount(1)
      const key = `h${(await run.getAttribute('data-testid'))!.slice('iw-run-'.length)}`
      await page().getByTestId(`iw-revert-open-${key}`).click()
      await expect(page().getByTestId(`iw-revert-preview-${key}`)).toContainText('delete 2 added rows')
      await page().getByTestId(`iw-revert-confirm-${key}`).click()
      await expect(page().getByTestId(`iw-revert-result-${key}`)).toContainText('2 restored, 2 deleted')
    })
  })

  await s.chapter('Find your way around', 60_000, async () => {
    await s.step('Down: T Nagar counts 120 assets, now that "T. Nagar" is T Nagar too', async () => {
      await openTable(page(), 'Stores')
      await page().getByRole('link', { name: 'T Nagar', exact: true }).first().click()
      await expect(page().getByRole('button', { name: /^Assets\s*120$/ }).first()).toBeVisible()
    })
    await s.step('They open beside the store, without leaving it', async () => {
      await page().getByRole('button', { name: /^Assets\s*120$/ }).first().click()
      await expect(page().getByRole('complementary', { name: 'T Nagar' })).toContainText('Assets · 120 rows')
    })
    await s.step('One more click drills into an asset; the path keeps the way back', async () => {
      const pane = page().getByRole('complementary', { name: 'T Nagar' })
      await pane.getByRole('table').getByRole('row').filter({ hasText: 'TN-0001' }).first().getByRole('cell').first().click()
      const asset = page().getByRole('complementary', { name: 'TN-0001' })
      await expect(asset.getByRole('heading', { name: 'Points at' }).locator('xpath=..')).toContainText('T Nagar')
      await expect(page().getByRole('navigation', { name: 'Path' })).toContainText('T Nagar')
    })
    await s.step('Up: the asset\'s page names its store', async () => {
      await page().getByRole('complementary', { name: 'TN-0001' }).getByRole('link', { name: 'Open row page' })
        .or(page().getByRole('complementary', { name: 'TN-0001' }).getByRole('button', { name: 'Open row page' })).first().click()
      await expect(page().getByRole('heading', { name: 'Assets: TN-0001' })).toBeVisible()
      await expect(page().getByText(/^Store\s*T Nagar$/).first()).toBeVisible()
    })
    await s.step('Sideways: the tree unfolds its store, and every other asset there', async () => {
      await page().getByRole('tab', { name: 'Tree' }).or(page().getByRole('link', { name: 'Tree', exact: true })).or(page().getByRole('button', { name: 'Tree', exact: true })).first().click()
      const tree = page().getByRole('tree', { name: 'Around TN-0001' })
      await tree.getByRole('treeitem', { name: 'T Nagar' }).focus()
      await page().keyboard.press('ArrowRight')
      await tree.getByRole('treeitem', { name: /^Assets\s*120$/ }).focus()
      await page().keyboard.press('ArrowRight')
      await expect(tree.getByRole('treeitem', { name: 'TN-0002' })).toBeVisible()
    })
  }, 'Down from a store to its assets, up from an asset to its store, and across to its neighbours.')

  await s.chapter('Make links read as what they are', 60_000, async () => {
    await s.step('An asset is shown by its item, not its tag', async () => {
      await openTable(page(), 'Assets')
      await openColumns(page())
      await page().getByRole('radio', { name: 'Title: Item' }).click()
      await expect(page().getByTestId('ce-saved')).toContainText('is now the title')
    })
    await s.step('The tree around T Nagar now reads like the shop floor', async () => {
      await openTable(page(), 'Stores')
      await page().getByRole('link', { name: 'T Nagar', exact: true }).first().click()
      await page().getByRole('tab', { name: 'Tree' }).or(page().getByRole('link', { name: 'Tree', exact: true })).or(page().getByRole('button', { name: 'Tree', exact: true })).first().click()
      await expect(page().getByRole('tree', { name: 'Around T Nagar' }).getByRole('treeitem', { name: 'Billing counter' }).first()).toBeVisible()
    })
  })
})
