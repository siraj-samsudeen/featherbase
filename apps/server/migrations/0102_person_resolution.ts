// person-resolution Phase 1a-i (#275): identifier systems, person identifiers
// with history, ended sign-in identities, and the one-time dev backfill (code
// and email rows; StyleHR sign-ins kept by code — record numbers come after
// the deploy, `cli people:resolve`). The logic lives in src/
// (person-resolution-migration.ts).
import { formatResolutionPlan, migratePersonResolution } from '../src/person-resolution-migration'

export async function up() {
  console.log(formatResolutionPlan(await migratePersonResolution()))
}
