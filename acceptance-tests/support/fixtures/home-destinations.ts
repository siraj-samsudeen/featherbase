// Real owning-app lifecycle on a disposable acceptance database, not a new API.
import { sql } from '../../../apps/server/src/db'
import { provisionApp } from '../../../apps/server/src/app-lifecycle'
import { createTable, deleteTable } from '../../../apps/server/src/table-engine'
import { applyMigrations, migrationSchema } from '../../../apps/server/src/runtime-migrations'

if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('_acceptance_e2e'))
  throw new Error('Home destination fixtures require the disposable acceptance database')
const operation = process.argv[2]
const plant = { name: 'tasker.homeplant', label: 'Plant', id_pattern: 'prompt', title_column: 'title', track_changes: false,
  columns: [{ column_name: 'title', label: 'Title', column_type: 'Data' }] }
async function main() { try {
  await provisionApp('tasker', async () => {
    if (operation === 'setup') {
      for (const name of ['tasker.homeplant', 'tasker.homedepot']) {
        const [existing] = await sql`select 1 from table_def where name = ${name}`
        if (existing) await deleteTable(name, 'Administrator', { ownerApp: 'tasker' })
      }
      await createTable(plant, 'tasker')
    } else if (operation === 'rename') {
      await applyMigrations([migrationSchema.parse({ id: 'home_rename', fromVersion: '0.1.0', toVersion: '0.2.0',
        operations: [{ kind: 'renameTable', from: plant.name, to: 'tasker.homedepot' }] })], 'tasker')
    } else if (operation === 'delete') await deleteTable(plant.name, 'Administrator', { ownerApp: 'tasker' })
    else if (operation === 'recreate') await createTable(plant, 'tasker')
    else throw new Error(`Unknown fixture operation ${operation}`)
  })
} finally { await sql.end() } }
void main().catch(error => { console.error(error); process.exitCode = 1 })
