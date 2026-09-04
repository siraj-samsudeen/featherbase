import type { Page } from '@playwright/test'
import { journeyTest as test, expect, adminToken, signIn } from './fixtures'
import { deleteTableIfExists } from './cleanup'

// TLC-J1 / TLC-J2 — docs/specs/0007-table-lifecycle.md, in the feather-testing
// DSL.
//
// The rule this file exists to hold (TLC-H2): after the entry point, the
// journey NEVER navigates by URL. Every step is reached by clicking the thing
// a user would click. A spec that types `/admin/<Table>/new` asserts that the
// form works and says nothing about whether anyone could have opened it —
// which is exactly how #247 survived 60 spec files and 117 page.goto calls.
//
// Isolation: journey-owned names, pre-cleaned through table deletion (spec
// 0003) and deleted again by the walk, so a re-run meets a clean database.
// No skip path exists — a used database is a bug to fix, not a reason to pass.

const NOTE = 'Journey Lifecycle Note'
const REF = 'Journey Lifecycle Ref'
const SUB = 'Journey Lifecycle Line'
const ENC = encodeURIComponent(NOTE)

test('TLC-J1 / TLC-R1 / TLC-I1: declare a table, then reach its first row by clicking — never by URL', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  await deleteTableIfExists(request, token, REF)
  await deleteTableIfExists(request, token, NOTE)

  await signIn(session)

  // J1.1 — build the table through the builder, as a user does. This is the
  // journey's one and only navigation by address.
  await session.visit('/admin/new-table').assertHas('[data-testid="table-builder"]')
  await session.step('J1.1: name the table and declare one column', async ({ page }: { page: Page }) => {
    await page.getByTestId('dt-name').fill(NOTE)
    const row = page.getByTestId('dt-fields').locator('tbody tr[data-columnrow]').first()
    await row.locator('[data-rowfield=column_name]').fill('body')
    await row.locator('[data-rowfield=label]').fill('Body')
    await row.locator('[data-rowfield=in_list_view]').check()
    await page.getByTestId('dt-create').click()
  })

  // J1.1 — the round trip closes on the TABLE, not on the builder.
  await session
    .assertPath(`/admin/${ENC}`)
    .assertHas('[data-testid="list-view"]')
    .assertHas('[data-testid="list-total"]', { text: '0 total' })

  // J1.2 — the create affordance is in the toolbar, beside the other actions
  // (positive complement: Report and Import rendered too, so this asserts New
  // JOINED a toolbar that exists, not that some toolbar exists).
  await session
    .assertHas('[data-testid="open-report"]')
    .assertHas('[data-testid="open-import"]')
    .assertHas('[data-testid="list-new"]')

  // J1.2 — and the empty table offers the same way forward inline, which is
  // where a first-time user is actually looking.
  await session.assertHas('[data-testid="list-empty-new"]')

  // J1.3 — click New. From here to the end, only clicks.
  await session.step('J1.3: click New in the list toolbar', async ({ page }: { page: Page }) => {
    await page.getByTestId('list-new').click()
  })
  await session
    .assertPath(`/admin/${ENC}/new`)
    .assertHas('[data-testid="form-view"]')
    .assertHas('[data-field="body"]')

  // J1.4 — fill it in and save; the form stops being "New document" and
  // starts being a row with an id of its own.
  await session.assertHas('[data-testid="form-status"]', { text: 'New document' })
  await session.step('J1.4: fill the column and save', async ({ page }: { page: Page }) => {
    await page.locator('[data-field=body]').fill('the first note')
    await page.getByTestId('form-save').click()
  })
  await session.assertHas('[data-testid="form-status"]', { text: 'Saved' })
  await session.refutePath(`/admin/${ENC}/new`)

  // J1.5 — back to the list through the breadcrumb, which is the way back a
  // user has. The row is there and the total moved.
  await session.step('J1.5: return to the list via the breadcrumb', async ({ page }: { page: Page }) => {
    await page.getByTestId('breadcrumbs').getByText(NOTE).click()
  })
  await session
    .assertPath(`/admin/${ENC}`)
    .assertHas('[data-testid="list-total"]', { text: '1 total' })
    .assertHas('[data-testid="list-rows"]', { text: 'the first note' })

  // Self-cleaning: the walk removes what it made, through the capability
  // spec 0003 owns.
  await deleteTableIfExists(request, token, NOTE)
})

test('TLC-R1.settings: a settings table opens its single row and offers no create affordance', async ({
  session,
}) => {
  await signIn(session)

  // A settings-kind table has one row and no list, so there is nothing to
  // create and the affordance is ABSENT rather than disabled — the same
  // metadata gating DEL-R1 uses for the delete button.
  await session
    .visit('/admin/System Settings')
    .assertHas('[data-testid="form-view"]')
    .refuteHas('[data-testid="list-new"]')
})

test('TLC-R1.sub_table: a child table reached directly offers no create affordance', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  await deleteTableIfExists(request, token, SUB)

  // A sub-table's rows exist only inside a parent: `saveDoc` refuses a direct
  // child insert ("<table> is a child Table; save it through its parent"), so
  // an affordance here could only ever produce an error. The list itself
  // stays reachable — this asserts the absence, not a blocked page.
  expect(
    (
      await request.post('/api/table_def', {
        headers,
        data: {
          name: SUB,
          kind: 'sub_table',
          columns: [{ column_name: 'line', column_type: 'Data' }],
        },
      })
    ).status(),
  ).toBe(201)

  await signIn(session)
  await session
    .visit(`/admin/${encodeURIComponent(SUB)}`)
    .assertHas('[data-testid="list-view"]')
    .refuteHas('[data-testid="list-new"]')
    .refuteHas('[data-testid="list-empty-new"]')

  await deleteTableIfExists(request, token, SUB)
})

test('TLC-J2 / TLC-R3 / TLC-R4: delete a row from its own form, behind a confirmation that names it', async ({
  session,
  request,
}) => {
  const token = await adminToken(request)
  const headers = { Authorization: `Bearer ${token}` }
  // Referrer first, then referent — the refusal branch is why order matters.
  await deleteTableIfExists(request, token, REF)
  await deleteTableIfExists(request, token, NOTE)

  // Prior state, through the contracts under test: two rows, one of them
  // spoken for by a reference from another table.
  for (const data of [
    { name: NOTE, id_pattern: 'prompt', columns: [{ column_name: 'body', column_type: 'Data' }] },
    {
      name: REF,
      id_pattern: 'prompt',
      columns: [{ column_name: 'note', column_type: 'Reference', reference_table: NOTE }],
    },
  ]) {
    expect((await request.post('/api/table_def', { headers, data })).status()).toBe(201)
  }
  for (const row of [
    { table: NOTE, row: { row_id: 'note-1', body: 'spoken for' } },
    { table: NOTE, row: { row_id: 'note-2', body: 'a mistake' } },
    { table: REF, row: { row_id: 'ref-1', note: 'note-1' } },
  ]) {
    expect((await request.post('/api/save_row', { headers, data: row })).status()).toBe(201)
  }

  await signIn(session)

  // J2.1 — the row I am looking at is the row I can remove; Delete sits
  // beside Rename, not in a list I have to navigate back to.
  await session
    .visit(`/admin/${ENC}/note-2`)
    .assertHas('[data-testid="form-rename"]')
    .assertHas('[data-testid="form-delete"]')

  // J2.2 — the confirmation NAMES the row (TLC-R4: a dialog that could be
  // shown for any target carries no information).
  await session
    .clickButton('Delete')
    .assertHas('[data-testid="delete-row-dialog"]')
    .assertText(`Delete ${NOTE} note-2?`)
    .assertText('This cannot be undone')

  // Branch at J2.2 — cancel leaves the row exactly where it was.
  await session.step('J2.2 branch: dismiss the confirmation', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-row-cancel').click()
  })
  await session
    .refuteHas('[data-testid="delete-row-dialog"]')
    .assertPath(`/admin/${ENC}/note-2`)
    .assertHas('[data-testid="form-view"]')

  // J2.3 — confirm: landed on the list, the row gone, the total moved.
  await session.clickButton('Delete').assertHas('[data-testid="delete-row-dialog"]')
  await session.step('J2.3: confirm the deletion', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-row-confirm').click()
  })
  await session
    .assertPath(`/admin/${ENC}`)
    .assertHas('[data-testid="list-total"]', { text: '1 total' })
  await session.step('J2.3: the row is gone from the list', async ({ page }: { page: Page }) => {
    await expect(page.getByTestId('list-rows')).not.toContainText('a mistake')
  })

  // Branch at J2.3 — something references it: the refusal is reported IN the
  // dialog, naming the holder, and the row survives (TLC-R3.referenced).
  await session
    .visit(`/admin/${ENC}/note-1`)
    .clickButton('Delete')
    .assertHas('[data-testid="delete-row-dialog"]')
  await session.step('J2.3 branch: confirm a deletion the server will refuse', async ({ page }: { page: Page }) => {
    await page.getByTestId('delete-row-confirm').click()
  })
  await session
    .assertHas('[data-testid="delete-row-error"]', { text: 'ref-1' })
    .assertPath(`/admin/${ENC}/note-1`)

  await deleteTableIfExists(request, token, REF)
  await deleteTableIfExists(request, token, NOTE)
})
