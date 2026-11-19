// #1321: every stored Table gets the two search indexes createTable now makes,
// so search finds a row named or coded exactly as typed in a Table of any size.
import { sql } from '../src/db'
import { syncSearchIndexes } from '../src/search-indexes'

export async function up() {
  const tables = await sql<{ name: string }[]>`
    select name from table_def where kind = 'table' and data_source is null order by name`
  for (const { name } of tables) await syncSearchIndexes(sql, name)
}
