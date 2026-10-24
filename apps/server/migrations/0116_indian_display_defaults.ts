// Display defaults for an Indian business (#380 review, Siraj's decision
// 22-Oct-2026): dates have one display form, DD-Mon-YYYY (ADR 844 of the data
// warehouse; ISO stays machine-facing), and a clean install shows rupees.
// Clean start: the retired date formats are removed outright, and an install
// that had chosen one moves to DD-Mon-YYYY. A currency someone chose is kept.
import { sql } from '../src/db'

export async function up() {
  const [ss] = await sql`select 1 from table_def where name = 'System Settings'`
  if (!ss) return // 0024 not applied (fresh non-single install) — nothing to change

  await sql`update column_def set choices = 'dd-mon-yyyy', default_value = 'dd-mon-yyyy'
    where parent = 'System Settings' and column_name = 'date_format'`
  await sql`update column_def set default_value = 'INR'
    where parent = 'System Settings' and column_name = 'currency'`
  await sql`update single_value set value = 'dd-mon-yyyy'
    where table_name = 'System Settings' and field = 'date_format' and value is distinct from 'dd-mon-yyyy'`
}
