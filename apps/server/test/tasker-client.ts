import { makeClient, type TestClient } from 'feather-testing-postgres'
import { version } from '../../../runtime-apps/tasker/package.json'

// Model a client built with this package. Raw clients remain available for
// explicit missing/old-version rejection checks; never change global HTTP.
export function taskerClient(client: TestClient): TestClient {
  return makeClient({ request: (path, init) => client.fetch(String(path), {
    ...init,
    headers: { 'X-Featherbase-App-Version': `tasker@${version}`, ...init?.headers },
  }) }, client.token, client.user)
}
