// Guard against a `choices` value holding a LITERAL backslash-n where a real
// newline belongs.
//
// `choices` is a newline-separated option list; `tableSchemaToZod`
// (packages/shared/src/schema.ts) splits it on '\n' to build the Choice enum.
// A value carrying the two characters `\` and `n` instead therefore collapses
// to a single enum member, and every save of that column fails with 417
// ValidationError — "Expected 'basic\nrestricted', received 'basic'".
//
// How it got in (#93): Postgres runs with `standard_conforming_strings = on`,
// so in a .sql migration `'basic\nrestricted'` is a backslash and an `n`, not
// a newline — only `E'basic\nrestricted'` escapes. Five sites in
// 0004_bootstrap.sql and 0055_terminology_rename.sql dropped the `E` while
// their immediate neighbours kept it, corrupting Table.kind, Column.tier and
// Permission.tier and breaking 63 server tests. The .ts migrations were never
// at risk: '\n' in TypeScript source is already a real newline.
//
// Two guards, because they fail at different moments and neither subsumes the
// other:
//
//   1. "seeded choices" reads the migrated database. It is closest to the real
//      failure mode and catches a bad value arriving by ANY route — a .ts
//      migration, a patch, the import wizard, a hand-run UPDATE. Its blind
//      spot is that it only sees the database it is pointed at: a dev database
//      that has already had the repair migration applied stays green even if
//      the migration sources are still wrong. CI migrates a fresh Postgres
//      before `pnpm -r test`, so there the check is meaningful.
//   2. "migration sources" reads the .sql files themselves. It fails in the
//      diff that introduces the mistake, on any database, already-repaired or
//      not — but only covers that one route in.

import { describe, expect, it } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { checkMigrations, formatHit } from '../scripts/check-sql-escapes'

// The two characters, as a bind parameter. Passed to strpos() rather than
// LIKE on purpose: LIKE treats backslash as its own escape character, so
// `like '%\n%'` would quietly search for a plain "n".
const LITERAL_BACKSLASH_N = '\\n'

type Offender = { source: string; owner: string; value: string }

describe('seeded `choices` never holds a literal backslash-n (#93)', () => {
  test('no Choice option list in the database was written unescaped', async () => {
    // Every place a Choice option list is stored: the column definitions
    // themselves, the customization layer that adds columns to an existing
    // Table, and the override layer that can replace one column's `choices`.
    const offenders = await sql<Offender[]>`
      select 'column_def' as source,
             parent || '.' || column_name as owner,
             choices as value
        from column_def
       where strpos(coalesce(choices, ''), ${LITERAL_BACKSLASH_N}) > 0

      union all

      select 'custom_field',
             dt || '.' || column_name,
             choices
        from custom_field
       where strpos(coalesce(choices, ''), ${LITERAL_BACKSLASH_N}) > 0

      union all

      select 'metadata_override',
             table_name || '.' || coalesce(column_name, '<table>'),
             value
        from metadata_override
       where property = 'choices'
         and strpos(coalesce(value, ''), ${LITERAL_BACKSLASH_N}) > 0

       order by 1, 2`

    // Report the offenders, not just a count — the whole difficulty of #93 was
    // that the symptom (417 on save) pointed nowhere near the cause.
    expect(
      offenders.map((o) => `${o.source}: ${o.owner} = ${JSON.stringify(o.value)}`),
    ).toEqual([])
  })

  test('the Choice columns #93 corrupted parse back to their full option sets', async () => {
    // A regression pin on the three specific victims. `strpos` above would
    // catch these too; this states what the values are supposed to BE, so a
    // future truncation that loses options without adding a backslash still
    // fails here.
    const rows = await sql<{ parent: string; column_name: string; choices: string }[]>`
      select parent, column_name, choices from column_def
       where (parent, column_name) in (('Table', 'kind'), ('Column', 'tier'), ('Permission', 'tier'))
       order by parent, column_name`

    const options = Object.fromEntries(
      rows.map((r) => [`${r.parent}.${r.column_name}`, r.choices.split('\n').map((o) => o.trim())]),
    )

    expect(options).toEqual({
      'Column.tier': ['basic', 'restricted'],
      'Permission.tier': ['basic', 'restricted'],
      'Table.kind': ['table', 'sub_table', 'settings'],
    })
  })
})

describe('migration sources never write a literal backslash-n (#93)', () => {
  // No database needed, so a plain `it` rather than the sandbox `test`.
  it('every .sql literal containing backslash-n carries the E prefix', () => {
    expect(checkMigrations().map(formatHit)).toEqual([])
  })
})
