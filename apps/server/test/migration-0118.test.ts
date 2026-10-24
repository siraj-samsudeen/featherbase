// Migration 0118 (24-Oct-2026): the Desk calls the Sales Target Assignment's
// material_group column "Subcategory". A Table created before its definition
// carried the label is relabelled; a label someone set by hand is kept.
import { readFileSync } from 'node:fs'
import { describe, expect } from 'vitest'
import { test } from './pg-test'
import { sql } from '../src/db'
import { ASSIGNMENT_TABLE, seedSalesTarget } from '../src/sales-target'

const MIGRATION = readFileSync(new URL('../migrations/0118_sales_target_subcategory_label.sql', import.meta.url), 'utf8')
const PASSWORDS = { test_employee_1: 'pw-1', test_employee_2: 'pw-2', test_employee_3: 'pw-3', test_employee_4: 'pw-4' }

async function label(): Promise<string> {
  const [row] = await sql`select label from column_def where parent = ${ASSIGNMENT_TABLE} and column_name = 'material_group'`
  return row.label
}

describe('0118: the material_group column reads "Subcategory"', () => {
  test('a newly seeded Table carries the label', async ({ admin }) => {
    await seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, [])
    expect(await label()).toBe('Subcategory')
  })

  test('a Table created with the default label is relabelled', async ({ admin }) => {
    await seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, [])
    await sql`update column_def set label = 'material_group' where parent = ${ASSIGNMENT_TABLE} and column_name = 'material_group'`
    await sql.unsafe(MIGRATION)
    expect(await label()).toBe('Subcategory')
  })

  test('a label set by hand is kept', async ({ admin }) => {
    await seedSalesTarget((path, init) => admin.fetch(path, init), PASSWORDS, [])
    await sql`update column_def set label = 'Sub-category (MATKL)' where parent = ${ASSIGNMENT_TABLE} and column_name = 'material_group'`
    await sql.unsafe(MIGRATION)
    expect(await label()).toBe('Sub-category (MATKL)')
  })
})
