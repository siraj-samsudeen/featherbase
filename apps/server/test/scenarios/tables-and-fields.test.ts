// tables-and-fields' fenced scenario that the server alone proves (#1070): the
// readable-labels migration applied over a database whose wording people have
// already changed. The test is one fenced scenario of
// openspec/specs/tables-and-fields/spec.md, step by step; the scenarios a
// person reads on screen are in apps/web/test/scenarios/.
import { describe, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { sql } from '../../src/db'
import { invalidateMeta } from '../../src/meta'
import { test } from '../pg-test'
import { scenarioFor } from '../scenario'

const scenario = scenarioFor(test, 'tables-and-fields')
const migration = readFileSync(new URL('../../migrations/0006_readable_labels.sql', import.meta.url), 'utf8')

describe('tables-and-fields', () => {
  scenario('Upgrade preserves customized wording', async ({ admin }, step) => {
    let overridesBefore: unknown[] = []
    await step('the user has customized and translated labels beside unchanged platform defaults', async () => {
      await sql`update column_def set label = case column_name
        when 'client_id' then 'client_id' when 'service_url' then 'My endpoint wording'
        when 'new_person' then 'new_person' end
        where parent = 'Sign In Method' and column_name in ('client_id', 'service_url', 'new_person')`
      await admin.post('/api/save_row', {
        table: 'Translation',
        row: { row_id: 'labels-826-new-person', language: 'fr', source_text: 'new_person', translated_text: 'Politique conservée' },
      })
      await admin.post('/api/table/Metadata%20Override', {
        row_id: 'labels-826-override', table_name: 'Sign In Method', column_name: 'client_id', property: 'label', value: 'Customer key override',
      })
      overridesBefore = [...(await sql`select * from metadata_override order by row_id`)]
    })
    await step('the platform label update is applied', async () => {
      await sql.unsafe(migration)
      invalidateMeta()
    })
    await step('eligible unchanged platform defaults become readable without displacing installed translations', async () => {
      const rows = await sql`select column_name, label from column_def
        where parent = 'Sign In Method' and column_name in ('client_id', 'new_person') order by column_name`
      expect([...rows]).toEqual([{ column_name: 'client_id', label: 'Client ID' }, { column_name: 'new_person', label: 'new_person' }])
    })
    await step("the user's custom wording and effective translations remain unchanged", async () => {
      expect([...(await sql`select label from column_def where parent = 'Sign In Method' and column_name = 'service_url'`)])
        .toEqual([{ label: 'My endpoint wording' }])
      expect([...(await sql`select * from metadata_override order by row_id`)]).toEqual(overridesBefore)
      expect([...(await sql`select translated_text from translation where source_text = 'new_person' and language = 'fr'`)])
        .toEqual([{ translated_text: 'Politique conservée' }])
    })
  })
})
