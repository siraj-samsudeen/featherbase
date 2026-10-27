// person-rename (#275): User → Person, service accounts in their own table,
// one principal model, opaque psn_/svc_ ids for everyone but the built-ins.
// The logic lives in src/ (person-rename-migration.ts).
import { formatPersonRenameReport, migratePersonRename } from '../src/person-rename-migration'

export async function up() {
  console.log(formatPersonRenameReport(await migratePersonRename()))
}
