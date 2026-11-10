/**
 * #625, #969: can an app's dataset query run on this source without being able
 * to change it? Postgres runs the query in a read-only transaction; a local
 * DuckDB file is opened read-only (a folder's files are attached read-only, #1123);
 * a MotherDuck session attaches its databases
 * read-only, whatever rights the token has. Any other engine cannot run a
 * dataset query at all.
 */
export function datasetSourceReadOnly(source: { engine: string }): boolean {
  return ['postgres', 'duckdb', 'motherduck'].includes(source.engine)
}
