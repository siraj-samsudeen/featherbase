import { sql } from './db'
import { AppError } from './errors'
import { getMeta } from './meta'
import { saveDoc } from './document'

// WEB-002: public web forms. A published Web Form exposes a whitelist of a
// target Table's columns; an (anonymous) submit creates a row of that Table
// through the normal save lifecycle, so server validation still applies.
// Only whitelisted columns are accepted, and only for the configured Table.

export interface WebFormColumn {
  column_name: string
  label: string
  column_type: string
  reference_table: string | null
  reqd: boolean
}

export interface WebFormConfig {
  route: string
  title: string
  ref_table: string
  success_message: string
  columns: WebFormColumn[]
}

async function loadForm(route: string) {
  const [form] = await sql`
    select row_id, title, route, ref_table, web_fields, published, success_message
    from web_form where route = ${route}`
  if (!form || !form.published)
    throw new AppError('NotFoundError', `No published web form at ${route}`)
  return form
}

function columnNames(webFields: unknown): string[] {
  if (Array.isArray(webFields)) return webFields.map(String)
  if (typeof webFields === 'string' && webFields.trim()) {
    try {
      const parsed = JSON.parse(webFields)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

export async function getWebFormConfig(route: string): Promise<WebFormConfig> {
  const form = await loadForm(route)
  const meta = await getMeta(form.ref_table as string)
  const wanted = new Set(columnNames(form.web_fields))
  const columns: WebFormColumn[] = meta.columns
    .filter((f) => wanted.has(f.column_name))
    .map((f) => ({
      column_name: f.column_name,
      label: f.label ?? f.column_name,
      column_type: f.column_type,
      reference_table: f.reference_table ?? null,
      reqd: Boolean(f.reqd),
    }))
  return {
    route: form.route as string,
    title: form.title as string,
    ref_table: form.ref_table as string,
    success_message: (form.success_message as string) ?? 'Submitted.',
    columns,
  }
}

export async function submitWebForm(
  route: string,
  values: Record<string, unknown>,
  // WEB-003: when the submitter is logged in, the row is created in their
  // name so it belongs to them (created_by) and shows up in their
  // own_rows_only portal.
  sessionUser?: string,
): Promise<{ row_id: string; message: string }> {
  const form = await loadForm(route)
  const allowed = new Set(columnNames(form.web_fields))
  // Accept ONLY whitelisted columns — a submitter can't set arbitrary columns.
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (allowed.has(k)) clean[k] = v

  // Create through the normal lifecycle (validation, hooks). The web form is a
  // trusted server-controlled surface strictly limited to the configured
  // Table + whitelisted columns, so it inserts with permissions bypassed:
  // anonymous submits create as Administrator, logged-in submits create as the
  // session user even when their roles carry no create Permission.
  const doc = await saveDoc(form.ref_table as string, clean, sessionUser ?? 'Administrator', 'upsert', {
    skipPermissions: true,
  })
  return {
    row_id: doc.row_id as string,
    message: (form.success_message as string) ?? 'Submitted.',
  }
}
