import { makeClient, type TestClient } from 'feather-testing-postgres'
import { version } from '../../../example-apps/tasker/package.json'

// Model a client built with this package. Raw clients remain available for
// explicit missing/old-version rejection checks; never change global HTTP.
export function taskerClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `tasker@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}

/** Explicit fixture setup: administrative privilege alone does not admit a
 * person to Tasker. Call only after installing its declared membership role. */
export async function admitTasker(client: TestClient): Promise<void> {
  if (!client.user) throw new Error('Tasker membership setup needs an identified client')
  const { getDoc, saveDoc } = await import('../src/document')
  const person = await getDoc('Person', client.user, 'Administrator')
  const roles = person.roles as Record<string, unknown>[]
  if (!roles.some(row => row.role === 'Tasker Member'))
    await saveDoc('Person', { row_id: person.row_id, updated_at: person.updated_at, roles: [...roles, { role: 'Tasker Member' }] }, 'Administrator')
}
