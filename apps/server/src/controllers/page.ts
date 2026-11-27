import { PAGE_NAME, checkPage, type PageColumnUse } from 'shared'
import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { getMeta } from '../meta'
import { RESERVED_MODULE_MESSAGE, STANDARD_COLUMNS, isReservedModule } from '../table-engine'

// #1410 (ADR 0028, design D2): a page's definition is checked every time its
// row is saved, inside the save's transaction, so a wrong page is never stored
// whichever way it arrives (the form, the HTTP API, an agent's save_page). The
// shape is checked by the shared checker; this adds what only the server knows:
// that each Table and column a page reads or writes exists.

type Tx = Parameters<NonNullable<TableController['hooks']['before_validate']>>[0]['tx']

async function checkColumns(tx: Tx, fields: Record<string, string>, table: string, at: string, columns: PageColumnUse[]) {
  const [exists] = await tx`select 1 from table_def where name = ${table}`
  if (!exists) {
    fields[at] ??= `There is no Table "${table}"`
    return
  }
  const known = new Set<string>([...STANDARD_COLUMNS, ...(await getMeta(table)).columns.map((column) => column.column_name)])
  for (const use of columns) if (!known.has(use.column)) fields[use.at] ??= `"${table}" has no column "${use.column}"`
}

const controller: TableController = {
  table: 'Page',
  hooks: {
    before_validate: async ({ row, isNew, tx }) => {
      const fields: Record<string, string> = {}
      if (isNew && !PAGE_NAME.test(String(row.row_id ?? '')))
        fields.row_id = 'A page\'s name is its address: lower-case words joined by hyphens, such as "reorder-plan"'
      if (typeof row.module === 'string' && isReservedModule(row.module)) fields.module = RESERVED_MODULE_MESSAGE.replace('this Table', 'this page')
      let definition = row.definition
      if (typeof definition === 'string') {
        try {
          definition = JSON.parse(definition)
        } catch {
          definition = undefined
          fields.definition = 'The definition is not valid JSON'
        }
      }
      if (!fields.definition) {
        const check = checkPage(definition)
        Object.assign(fields, check.fields)
        for (const source of check.tables) await checkColumns(tx, fields, source.table, source.at, source.columns)
        for (const write of check.writes) await checkColumns(tx, fields, write.table, `${write.at}.table`, write.columns)
        // Stored as the object it is, however it arrived.
        row.definition = definition
      }
      const mistakes = Object.keys(fields).length
      if (mistakes) throw new AppError('ValidationError', `The page has ${mistakes === 1 ? 'a mistake' : `${mistakes} mistakes`}. Nothing was saved.`, fields)
    },
    // A page is never lost from navigation: its module's home page is made on
    // demand, as a new Table's is (#80). After the commit, like every other
    // write the save itself did not make.
    after_commit: async ({ row }) => {
      // A delete commits too, with no module to file anything under.
      if (typeof row.module === 'string') await (await import('../home-pages')).ensureModuleHomePage(row.module)
    },
  },
}

export default controller
