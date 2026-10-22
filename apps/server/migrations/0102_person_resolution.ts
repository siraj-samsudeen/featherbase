// person-resolution Phase 1a-i (#275): identifier systems, person identifiers
// with history, ended sign-in identities, and the one-time dev backfill from
// the warehouse's resolve file. Logic in src/ so `cli people:plan` rehearses it.
import { formatResolutionPlan, migratePersonResolution } from '../src/person-resolution-migration'

export async function up() {
  console.log(formatResolutionPlan(await migratePersonResolution()))
}
