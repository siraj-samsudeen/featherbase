import { AppError } from '../errors'
import { registerRowAction } from '../actions'
import { assertSystemManager } from '../permissions'
import { testSource } from '../sources/registry'
import { introspectSource, reflectTables } from '../sources/reflect'

// EDS-1/EDS-2/EDS-3 surfaced as row actions on the Data Source Table:
//   POST /api/table/Data Source/<name>:test_connection
//   GET  /api/table/Data Source/<name>:introspect?schema=...
//   POST /api/table/Data Source/<name>:reflect { schema?, tables, module?, prefix? }
// The registry lists actions globally (like :submit), so each handler guards
// on the Table; P3: System Manager only — sources hold the keys to
// production data.

function assertDataSource(table: string): void {
  if (table !== 'Data Source')
    throw new AppError('NotFoundError', `No such action for ${table}`)
}

registerRowAction('test_connection', {
  effect: 'write',
  description: 'Test a Data Source connection and stamp conn_status.',
  handler: async ({ table, name, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.name)
    return testSource(name)
  },
})

registerRowAction('introspect', {
  effect: 'read',
  description: 'List a Data Source’s tables and columns with proposed types.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.name)
    const schema = typeof args.schema === 'string' && args.schema ? args.schema : undefined
    const prefix = typeof args.prefix === 'string' && args.prefix ? args.prefix : undefined
    return introspectSource(name, schema, prefix)
  },
})

registerRowAction('reflect', {
  effect: 'write',
  description: 'Generate bound Tables from a Data Source’s tables.',
  handler: async ({ table, name, args, user }) => {
    assertDataSource(table)
    await assertSystemManager(user.name)
    const tables = Array.isArray(args.tables) ? (args.tables as string[]).map(String) : []
    return reflectTables(name, {
      schema: typeof args.schema === 'string' && args.schema ? args.schema : undefined,
      tables,
      module: typeof args.module === 'string' && args.module ? args.module : undefined,
      prefix: typeof args.prefix === 'string' && args.prefix ? args.prefix : undefined,
    })
  },
})
