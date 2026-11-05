// #772 design D4: a local stand-in for MotherDuck. `md_information_schema.duckdb`
// carries the account listing MotherDuck exposes (databases, shared_with_me) plus
// the stand-in's own `tokens`; every database is a local file. Made-up data only.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const STANDIN_TOKENS = {
  reader: 'standin-read-scaling-token-4f2a',
  writer: 'standin-read-write-token-77b1',
  second: 'standin-second-read-token-9c1e',
  // The reader's own account, with a read-write token: same owned databases.
  readerWriter: 'standin-reader-write-token-5d3a',
  refused: 'standin-revoked-token-0000',
}

const OWNED = ['sales', 'stock']
const SHARED: [string, string][] = [['finance', 'finance-team'], ['people', 'people-team'], ['planning', 'planning-team']]

/** `owned`: the databases the stand-in account owns (an account can have none). */
export async function buildStandin(owned: string[] = OWNED): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'fb-motherduck-'))
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const write = async (file: string, statements: string[]) => {
    const instance = await DuckDBInstance.create(path.join(dir, file))
    const conn = await instance.connect()
    for (const s of statements) await conn.run(s)
    conn.closeSync()
    instance.closeSync()
  }
  await write('md_information_schema.duckdb', [
    `create table databases (name varchar)`,
    ...owned.map((n) => `insert into databases values ('${n}')`),
    `create table shared_with_me (name varchar, url varchar, owner varchar)`,
    `insert into shared_with_me values ${SHARED.map(([n, o]) => `('${n}', '${path.join(dir, `${n}.duckdb`)}', '${o}')`).join(', ')}`,
    `create table tokens (token varchar, user_name varchar, can_write boolean)`,
    `insert into tokens values ('${STANDIN_TOKENS.reader}', 'reader_user', false), ('${STANDIN_TOKENS.writer}', 'writer_user', true), ('${STANDIN_TOKENS.second}', 'reader_user', false), ('${STANDIN_TOKENS.readerWriter}', 'reader_user', true)`,
  ])
  await write('sales.duckdb', [
    `create table stores (code varchar, name varchar, city varchar, state_code varchar)`,
    `insert into stores values ('S001', 'Harbour Road', 'Port Town', '32'), ('S002', 'Hill Street', 'Upton', '33'), ('S003', 'Market Lane', 'Port Town', '32')`,
    // A view whose table is gone: it lists its columns but fails when read.
    `create table gone_soon (a integer)`,
    `create view broken_view as select a from gone_soon`,
    `drop table gone_soon`,
    `create schema history`,
    `create table history.closed_stores (code varchar, closed_on date)`,
  ])
  await write('stock.duckdb', [`create table items (sku varchar, qty integer)`])
  for (const [name] of SHARED) await write(`${name}.duckdb`, [`create table notes (id integer)`])
  return dir
}

/** Adds a table to a stand-in database, as if the warehouse grew. */
export async function addStandinTable(dir: string, database: string, table: string): Promise<void> {
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(path.join(dir, `${database}.duckdb`))
  const conn = await instance.connect()
  await conn.run(`create table ${table} (id integer)`)
  conn.closeSync()
  instance.closeSync()
}

/** Runs statements against one stand-in database file, as if the warehouse changed. */
export async function changeStandin(dir: string, database: string, statements: string[]): Promise<void> {
  const { DuckDBInstance } = await import('@duckdb/node-api')
  const instance = await DuckDBInstance.create(path.join(dir, `${database}.duckdb`))
  const conn = await instance.connect()
  for (const s of statements) await conn.run(s)
  conn.closeSync()
  instance.closeSync()
}
