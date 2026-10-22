// person-rename R3: the handler registry classifies EVERY text column of
// every relation Featherbase owns. A column nobody classified fails the plan,
// so a new platform table that carries a person id cannot slip past a re-id
// or a merge unnoticed.
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { classifyColumns } from '../src/person-registry'

const cls = async () => {
  const c = await classifyColumns()
  const byKey = new Map(c.classified.map((x) => [`${x.relation}.${x.column}`, x]))
  return { c, byKey }
}

describe('person registry: classification', () => {
  test('every text column of every platform and app relation is classified', async () => {
    const { c } = await cls()
    expect(c.unclassified).toEqual([])
    // It really walked the database, not a hand list.
    const [{ n }] = await sql`
      select count(*)::int as n from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'featherbase' and c.data_type in ('character varying', 'text', 'character', 'json', 'jsonb')`
    expect(c.classified.filter((x) => x.schema === 'featherbase').length).toBe(n)
  })

  test('person-carrying columns are ids; codes and free text are declared, not guessed', async () => {
    const { byKey } = await cls()
    const classOf = (k: string) => byKey.get(k)?.class
    // ids
    for (const k of ['access_token.person', 'access_token.service_account', 'data_scope.person', 'share.person',
      'sign_in_identity.person_id', 'activity_log.user', 'user_settings.user', 'password_reset.user',
      'assignment_rule.last_user', 'assignment_rule_user.user', 'todo.allocated_to', 'notification_log.for_user',
      'comment.created_by', 'version.updated_by'])
      expect(classOf(k), k).toBe('id')
    // conditional ids: only when the sibling type column names Person
    expect(byKey.get('data_scope.for_value')).toMatchObject({ class: 'conditional-id', typeColumn: 'allow_table' })
    expect(byKey.get('share.share_name')).toMatchObject({ class: 'conditional-id', typeColumn: 'share_table' })
    expect(byKey.get('has_role.parent')).toMatchObject({ class: 'conditional-id', typeColumn: 'parenttype' })
    // the generated pair follows parent: scanned, never written
    expect(byKey.get('has_role.person')).toMatchObject({ class: 'id', generated: true })
    // json with ids
    expect(classOf('saved_view.filters')).toBe('json-with-ids')
    expect(classOf('home_page.shortcuts')).toBe('json-with-ids')
    // codes: never rewritten, never scanned
    for (const k of ['sign_in_identity.subject', 'sign_in_identity.sign_in_name', 'person.email', 'person.username'])
      expect(classOf(k), k).toBe('code')
    // free text: never scanned
    for (const k of ['comment.content', 'notification_log.subject', 'activity_log.operation'])
      expect(classOf(k), k).toBe('free-text')
  })

  test('an app Table is classified from its metadata: a Reference to Person is an id', async ({ admin }) => {
    await admin.post('/api/table_def', {
      name: 'Registry Probe',
      columns: [
        { column_name: 'owner_person', column_type: 'Reference', reference_table: 'Person' },
        { column_name: 'notes', column_type: 'Text' },
        { column_name: 'code', column_type: 'Data' },
      ],
    })
    const { c, byKey } = await cls()
    expect(c.unclassified).toEqual([])
    expect(byKey.get('registry_probe.owner_person')?.class).toBe('id')
    expect(byKey.get('registry_probe.notes')?.class).toBe('free-text')
    expect(byKey.get('registry_probe.code')?.class).toBe('code')
  })

  test('an unknown raw platform column is reported unclassified', async () => {
    await sql`alter table featherbase.access_token add column mystery_principal varchar(140)`
    const { c } = await cls()
    expect(c.unclassified).toContainEqual(expect.objectContaining({ relation: 'access_token', column: 'mystery_principal' }))
  })
})
