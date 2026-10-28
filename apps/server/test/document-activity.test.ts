import { expect } from 'vitest'
import { test } from './pg-test'
import { ROW_ID_HOLDERS } from '../src/document-activity'
import { classifyColumns } from '../src/person-registry'
import { PLATFORM_SCHEMA } from '../src/platform-schema'

// SPEC: A renamed row keeps its activity (tables-and-fields), #509. The person
// registry classifies every platform column; a conditional id is exactly a
// column naming one row of the Table its sibling column names. The rename
// cascade must cover every one of them, so a new such column cannot be left
// behind under a row's old id.
test('the rename cascade covers every platform column that names a row by id', async () => {
  const { classified } = await classifyColumns()
  const registry = classified
    .filter((c) => c.schema === PLATFORM_SCHEMA && c.class === 'conditional-id' && c.column !== 'parent')
    .map((c) => `${c.relation}.${c.typeColumn}.${c.column}`)
    .sort()
  const cascade = ROW_ID_HOLDERS.map((h) => `${h.relation}.${h.tableColumn}.${h.nameColumn}`).sort()
  expect(cascade).toEqual(registry)
})
