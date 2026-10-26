import { currentEnvironment, environmentDeclared, overrideVariable, readVariable } from './env'
import { parseInstanceAddresses, type InstanceAddress } from './instance-addresses'

export { environmentDeclared }

// Which environment this process is running as (env.ts currentEnvironment).
// Vitest sets NODE_ENV=test itself, so the test suites land on 'test' without
// configuring anything. Fixed for the life of the process.
export const environment = currentEnvironment()

// The default database is derived from the environment, never shared across
// them. Rails (`app_development` / `app_test`), Phoenix (`app_dev` /
// `app_test`) and Django (a `test_` prefix) all separate the two BY NAME, so
// that running tests against the development database takes a deliberate act
// rather than a forgotten variable.
//
// This project used to default both to `featherbase`, which made OMITTING
// DATABASE_URL the thing that pointed a test run at the developer's own
// database — the default was backwards. An explicit DATABASE_URL still wins,
// and the environment stamp (src/db-environment.ts) catches the case where
// that explicit value is wrong.
const defaultDatabase = environment === 'test' ? 'featherbase_test' : 'featherbase'

// The list parsed once per distinct value: it is read on every request.
let parsed: { raw: string | undefined; list: InstanceAddress[] | null } | null = null
function addressesFrom(raw: string | undefined): InstanceAddress[] | null {
  if (parsed?.raw !== raw || !parsed) parsed = { raw, list: parseInstanceAddresses(raw, environment) }
  return parsed.list
}

export const config = {
  port: Number(readVariable('PORT') ?? 8000),
  environment,
  databaseUrl:
    readVariable('DATABASE_URL') ??
    `postgres://postgres:postgres@127.0.0.1:5432/${defaultDatabase}`,
  // API-008: origins allowed to call the API cross-origin (the Admin dev
  // server by default; comma-separated WEB_ORIGINS overrides).
  allowedOrigins: (
    readVariable('WEB_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173'
  ).split(','),
  // #488: what each web address of this instance opens, and which one emailed
  // links use (src/instance-addresses.ts). Configuration, so a request header
  // can only select an entry, never create one. null (unset) is allowed only
  // in development and test, where links fall back to the request's origin;
  // the release and the server start refuse it anywhere else (env.ts). Read
  // at call time; assigning it sets INSTANCE_ADDRESSES for this process only,
  // which the release checks see too (env.ts overrideVariable).
  get instanceAddresses(): InstanceAddress[] | null {
    return addressesFrom(readVariable('INSTANCE_ADDRESSES'))
  },
  set instanceAddresses(list: InstanceAddress[] | null) {
    overrideVariable(
      'INSTANCE_ADDRESSES',
      list ? JSON.stringify(list.map(({ address, opens, emails }) => ({ address, opens, emails }))) : '',
    )
  },
}

// An invalid INSTANCE_ADDRESSES stops the boot here, naming the rule it breaks.
void config.instanceAddresses
