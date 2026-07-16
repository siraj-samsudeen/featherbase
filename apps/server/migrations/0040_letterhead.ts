// PRN-004: Letter Head — a reusable header/footer block applied to printed
// documents. A Print Format may name a Letter Head; otherwise the one marked
// `is_default` is applied. Both header and footer support the same
// {{ field }} interpolation as Print Format templates.
import { sql } from '../src/db'
import { createDocType, updateDocType } from '../src/doctype-engine'
import { getMeta } from '../src/meta'

export async function up() {
  const [exists] = await sql`select 1 from tab_doctype where name = 'Letter Head'`
  if (!exists) {
    await createDocType({
      name: 'Letter Head',
      module: 'Core',
      autoname: 'prompt',
      fields: [
        { fieldname: 'is_default', fieldtype: 'Check', default_value: '0', in_list_view: true },
        { fieldname: 'header_html', fieldtype: 'Text' },
        { fieldname: 'footer_html', fieldtype: 'Text' },
      ],
    })
  }

  // Let a Print Format point at a Letter Head. Append the field to the
  // existing definition (updateDocType adds the column + docfield in place).
  const pf = await getMeta('Print Format')
  if (!pf.fields.some((f) => f.fieldname === 'letter_head')) {
    await updateDocType('Print Format', {
      module: pf.module,
      autoname: pf.autoname,
      fields: [
        ...pf.fields.map((f) => ({
          fieldname: f.fieldname,
          fieldtype: f.fieldtype,
          label: f.label,
          options: f.options ?? undefined,
          reqd: f.reqd,
          default_value: f.default_value ?? undefined,
          in_list_view: f.in_list_view,
        })),
        { fieldname: 'letter_head', fieldtype: 'Link', options: 'Letter Head' },
      ],
    })
  }
}
