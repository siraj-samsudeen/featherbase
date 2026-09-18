import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { ASSIGNMENT_TABLE } from '../sales-target'

// #3755: one employee per store–subcategory pair. The pair is written into
// `store_subcategory` on every save (insert and update alike, from the full
// row), and that column's unique constraint is what refuses a second owner.
// Codes are exact strings: a four-digit store and a nine-digit subcategory
// with its leading zeros — never a prefix, a range or a name.
const controller: TableController = {
  table: ASSIGNMENT_TABLE,
  hooks: {
    before_validate: ({ row }) => {
      const plant = String(row.plant_code ?? '').trim()
      const code = String(row.material_group ?? '').trim()
      const fields: Record<string, string> = {}
      if (!/^\d{4}$/.test(plant)) fields.plant_code = 'plant_code must be exactly four digits'
      if (!/^\d{9}$/.test(code)) fields.material_group = 'material_group must be exactly nine digits'
      if (Object.keys(fields).length) throw new AppError('ValidationError', Object.values(fields).join('; '), fields)
      row.plant_code = plant
      row.material_group = code
      row.store_subcategory = `${plant}/${code}`
    },
  },
}

export default controller
