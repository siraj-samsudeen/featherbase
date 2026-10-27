import { readNamedVariable } from '../env'

/**
 * #625: can an app's dataset query run on this source without being able to
 * change it? Postgres runs the query in a read-only transaction and a local
 * DuckDB file is opened read-only. A MotherDuck (`md:`) connection cannot be
 * opened read-only; it is read-only only when its token is a read-scaling
 * token, which the platform cannot detect, so an administrator says so on the
 * Data Source. Any other engine cannot run a dataset query at all.
 */
export function datasetSourceReadOnly(source: { engine: string; url_env: string | null; read_scaling_token?: boolean }): boolean {
  if (source.engine === 'postgres') return true
  if (source.engine !== 'duckdb') return false
  const url = source.url_env ? readNamedVariable(source.url_env) ?? '' : ''
  return !url.startsWith('md:') || source.read_scaling_token === true
}
