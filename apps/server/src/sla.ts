import { sql } from './db'
import type { TableMeta } from './meta'

// Service Level Agreements: a metadata-defined SLA names a Table, a priority
// column, and per-priority response/resolution windows (child table). On
// insert, matching rows get `response_by` / `resolution_by` deadlines
// stamped (the target Table simply declares those Datetime columns — no
// code). A scheduled job (`check_sla`, src/jobs/sla-escalation.ts) escalates
// rows past their resolution deadline.

export interface SlaPriorityRow {
  priority: string
  response_hours: number | null
  resolution_hours: number | null
}

export interface ActiveSla {
  row_id: string
  ref_table: string
  priority_field: string
  fulfilled_states: string[]
  escalation_role: string | null
  priorities: SlaPriorityRow[]
}

export async function getActiveSla(table: string): Promise<ActiveSla | null> {
  // The SLA Table may not exist yet during early migrations.
  const [tableOk] = await sql`
    select 1 from information_schema.tables
    where table_name = 'service_level_agreement'`
  if (!tableOk) return null
  const [sla] = await sql`
    select row_id, ref_table, priority_field, fulfilled_states, escalation_role
    from service_level_agreement
    where ref_table = ${table} and enabled = true
    order by updated_at desc limit 1`
  if (!sla) return null
  const rows = await sql<SlaPriorityRow[]>`
    select priority, response_hours, resolution_hours from sla_priority
    where parent = ${sla.row_id as string} and parenttype = 'Service Level Agreement'
    order by position`
  return {
    row_id: sla.row_id as string,
    ref_table: sla.ref_table as string,
    priority_field: ((sla.priority_field as string) || 'priority').trim(),
    fulfilled_states: String(sla.fulfilled_states ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    escalation_role: (sla.escalation_role as string) || null,
    priorities: rows,
  }
}

// Stamp response_by / resolution_by onto a new row's values from the
// active SLA for its Table. Only columns the Table actually declares are
// written; explicit caller-provided deadlines are left alone.
export async function applySla(meta: TableMeta, values: Record<string, unknown>): Promise<void> {
  const has = (columnName: string) => meta.columns.some((f) => f.column_name === columnName)
  if (!has('response_by') && !has('resolution_by')) return
  const sla = await getActiveSla(meta.name)
  if (!sla) return

  const priority = String(values[sla.priority_field] ?? '')
  const row = sla.priorities.find((p) => p.priority === priority)
  if (!row) return

  const now = Date.now()
  const hours = (h: number | null) => new Date(now + Number(h) * 3600 * 1000)
  if (has('response_by') && values.response_by == null && row.response_hours != null)
    values.response_by = hours(row.response_hours)
  if (has('resolution_by') && values.resolution_by == null && row.resolution_hours != null)
    values.resolution_by = hours(row.resolution_hours)
  if (has('sla_status') && values.sla_status == null) values.sla_status = 'On Track'
}
