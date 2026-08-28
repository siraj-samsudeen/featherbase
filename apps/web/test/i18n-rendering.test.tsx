// I18N-001: with a language chosen, every string that has a catalog entry
// renders translated and every string that does not falls back to its source.
// Pushed down from e2e/i18n.spec.ts (#223 batch 1). The push-down also
// retires that spec's worst hazard: Translation rows are unique on
// (language, source_text) and were committed by the browser run, so a spec
// that failed before its afterAll cleanup poisoned the *server* suite's
// i18n.test.ts. Seeded inside the sandbox transaction they simply roll back,
// and the clean-up code goes away with them.
//
// e2e/i18n-login.spec.ts stays: the signed-out login page picks its language
// from the browser, which is not a thing jsdom can be asked.
//
// One test per surface the rule reaches — chrome, metadata labels, the
// fallback, and the switch back — because a catalog that reaches one and not
// another is exactly the bug worth catching.

import { screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { test, expect, renderApp } from './pg-test'

const DT = 'I18n Doc'

type Admin = Parameters<typeof renderApp>[1]

async function seed(admin: Admin) {
  await admin.post('/api/table_def', {
    name: DT,
    columns: [
      { column_name: 'priority', label: 'Priority', column_type: 'Data', in_list_view: true },
      { column_name: 'owner_note', label: 'Owner Note', column_type: 'Data' },
    ],
  })
  for (const [source, translated] of [
    ['Save', 'Enregistrer'],
    ['Priority', 'Priorité'],
  ] as [string, string][])
    await admin.post('/api/save_row', {
      table: 'Translation',
      row: {
        row_id: `fr-${source}`,
        language: 'fr',
        source_text: source,
        translated_text: translated,
      },
    })
}

/**
 * Mount the new-row form and wait until whoami is in the query cache.
 *
 * That wait is load-bearing, not tidiness. setLanguage merges the new value
 * into the CACHED whoami (`qc.setQueryData`), so a change fired before the
 * first whoami response lands merges into nothing and is silently dropped by
 * the client even though the server accepted it.
 */
async function mountForm(admin: Admin) {
  const { queryClient } = await renderApp(`/admin/${encodeURIComponent(DT)}/new`, admin)
  await screen.findByTestId('form-view')
  await waitFor(() =>
    expect(queryClient.getQueryData(['whoami'])).toMatchObject({ language: 'en' }),
  )
  return queryClient
}

/**
 * Switch the language and wait for the server to own the choice. setLanguage
 * POSTs fire-and-forget; a test that returns before it lands lets the write
 * execute after its transaction rolled back — committing a French
 * Administrator into the database for every later test.
 */
async function switchTo(admin: Admin, language: string) {
  fireEvent.change(await screen.findByTestId('language-select'), { target: { value: language } })
  await waitFor(async () =>
    expect((await admin.get('/api/whoami')) as { language?: string }).toMatchObject({ language }),
  )
}

test('a chrome string with a catalog entry renders translated', async ({ admin }) => {
  await seed(admin)
  await mountForm(admin)
  expect(screen.getByTestId('form-save')).toHaveTextContent('Save')

  await switchTo(admin, 'fr')
  await waitFor(() => expect(screen.getByTestId('form-save')).toHaveTextContent('Enregistrer'))
})

test('a column label from Table metadata is translated too', async ({ admin }) => {
  await seed(admin)
  await mountForm(admin)
  expect(screen.getByText('Priority')).toBeInTheDocument()

  await switchTo(admin, 'fr')
  await waitFor(() => expect(screen.getByText('Priorité')).toBeInTheDocument())
  expect(screen.queryByText('Priority')).not.toBeInTheDocument()
})

test('a string with no catalog entry falls back to its source', async ({ admin }) => {
  await seed(admin)
  await mountForm(admin)
  await switchTo(admin, 'fr')
  await waitFor(() => expect(screen.getByTestId('form-save')).toHaveTextContent('Enregistrer'))

  // 'Owner Note' has no fr entry — it stays in the source language rather
  // than rendering blank or as its key.
  expect(screen.getByText('Owner Note')).toBeInTheDocument()
})

test('switching back to English reverts every translated string', async ({ admin }) => {
  await seed(admin)
  await mountForm(admin)
  await switchTo(admin, 'fr')
  await waitFor(() => expect(screen.getByTestId('form-save')).toHaveTextContent('Enregistrer'))

  await switchTo(admin, 'en')
  await waitFor(() => expect(screen.getByTestId('form-save')).toHaveTextContent('Save'))
  expect(screen.getByText('Priority')).toBeInTheDocument()
})
