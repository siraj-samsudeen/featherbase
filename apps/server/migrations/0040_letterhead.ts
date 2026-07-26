// PRN-004: Letter Head — a reusable header/footer block applied to printed
// documents. A Print Format may name a Letter Head; otherwise the one marked
// `is_default` is applied. Both header and footer support the same
// {{ field }} interpolation as Print Format templates.
import { sql } from '../src/db'
import { createTable, updateTable } from '../src/doctype-engine'
import { getMeta } from '../src/meta'

export async function up() {
  const [exists] = await sql`select 1 from table_def where name = 'Letter Head'`
  if (!exists) {
    await createTable({
      name: 'Letter Head',
      module: 'Core',
      id_pattern: 'prompt',
      columns: [
        { column_name: 'is_default', column_type: 'Check', default_value: '0', in_list_view: true },
        { column_name: 'header_html', column_type: 'Text' },
        { column_name: 'footer_html', column_type: 'Text' },
      ],
    })
  }

  // Let a Print Format point at a Letter Head. Append the column to the
  // existing definition (updateTable adds the column + column_def in place).
  const pf = await getMeta('Print Format')
  if (!pf.columns.some((f) => f.column_name === 'letter_head')) {
    await updateTable('Print Format', {
      module: pf.module,
      id_pattern: pf.id_pattern,
      columns: [
        ...pf.columns.map((f) => ({
          column_name: f.column_name,
          column_type: f.column_type,
          label: f.label ?? undefined,
          reference_table: f.reference_table ?? undefined,
          choices: f.choices ?? undefined,
          row_table: f.row_table ?? undefined,
          reqd: f.reqd,
          default_value: f.default_value ?? undefined,
          in_list_view: f.in_list_view,
        })),
        { column_name: 'letter_head', column_type: 'Reference', reference_table: 'Letter Head' },
      ],
    })
  }
}
